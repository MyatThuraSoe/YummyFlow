import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { fromCents, toCents } from "../lib/money.js";
import { audit } from "../lib/audit.js";
import { verifyManagerPin } from "../lib/approval.js";
import { EVENTS, emitToWorkspace } from "../lib/socket.js";
import { consumeForOrder } from "./inventory.service.js";
import { autoPrintReceipt, receiptTextForOrder } from "./receipt.service.js";
import { planLineRefund, priorRefundedQtyByLine, type RefundLineSelection, type RefundedLineSnapshot } from "./refundMath.js";
import type { PaymentMethod, Prisma } from "@prisma/client";

export interface TenderInput {
  method: PaymentMethod;
  amount: number;
  reference?: string | null;
  cashReceived?: number; // for CASH
}

export interface PayOrderInput {
  orderId: string;
  actorId: string;
  shiftId?: string | null;
  terminalId?: string | null;
  payments: TenderInput[];
  idempotencyKey?: string | null;
  splitId?: string | null;
}

export async function payOrder(input: PayOrderInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      return prisma.order.findUnique({ where: { id: existing.orderId }, include: { payments: true, lines: true } });
    }
  }

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { payments: true, lines: { include: { modifiers: true } }, tableSession: true },
  });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status === "CANCELLED") throw ApiError.conflict("Order is cancelled");
  if (order.paymentStatus === "SUCCEEDED") throw ApiError.conflict("Order already paid");

  const split = input.splitId
    ? await prisma.orderSplit.findUnique({ where: { id: input.splitId } })
    : null;
  if (input.splitId && (!split || split.orderId !== order.id)) throw ApiError.notFound("Split not found");
  if (split?.paid) throw ApiError.conflict("This person's bill is already paid");

  const total = toCents(order.total);
  const alreadyPaid = order.payments
    .filter((p) => p.status === "SUCCEEDED")
    .reduce((s, p) => s + toCents(p.amount), 0);
  const due = total - alreadyPaid;

  const tendered = input.payments.reduce((s, p) => s + toCents(p.amount), 0);
  if (tendered <= 0) throw ApiError.badRequest("Payment amount must be positive");

  let changeCents = 0;
  for (const p of input.payments) {
    if (p.method === "CASH") {
      const recv = toCents(p.cashReceived ?? p.amount);
      const amt = toCents(p.amount);
      if (recv < amt) throw ApiError.badRequest("Cash received is less than the amount tendered");
      changeCents += recv - amt;
    }
  }

  const newPaid = alreadyPaid + tendered;
  const completes = newPaid >= due + alreadyPaid || newPaid >= total;

  let splitMarkedPaid = false;
  const result = await prisma.$transaction(async (tx) => {
    let firstPaymentId: string | null = null;
    for (const p of input.payments) {
      const createdPayment = await tx.payment.create({
        data: {
          orderId: order.id,
          method: p.method,
          amount: fromCents(toCents(p.amount)),
          status: "SUCCEEDED",
          reference: p.reference ?? null,
          cashierId: input.actorId,
          shiftId: input.shiftId ?? order.shiftId ?? null,
          cashReceived: p.method === "CASH" ? fromCents(toCents(p.cashReceived ?? p.amount)) : null,
          changeGiven: p.method === "CASH" ? fromCents(toCents(p.cashReceived ?? p.amount) - toCents(p.amount)) : null,
          idempotencyKey: input.payments.length === 1 ? input.idempotencyKey ?? null : null,
        },
      });
      firstPaymentId ??= createdPayment.id;
      if (p.method === "CASH" && (input.shiftId ?? order.shiftId)) {
        await tx.cashMovement.create({
          data: {
            shiftId: (input.shiftId ?? order.shiftId)!,
            type: "CASH_SALE",
            amount: fromCents(toCents(p.amount)),
            direction: "IN",
            reference: order.id,
            actorId: input.actorId,
          },
        });
      }
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        amountPaid: fromCents(newPaid),
        changeGiven: fromCents(changeCents),
        paymentStatus: completes ? "SUCCEEDED" : "PENDING",
        ...(completes ? { status: "COMPLETED", completedAt: new Date() } : {}),
      },
    });

    if (split && tendered >= toCents(split.total)) {
      await tx.orderSplit.update({
        where: { id: split.id },
        data: { paid: true, paidAt: new Date(), paymentId: firstPaymentId },
      });
      splitMarkedPaid = true;
    }

    if (completes) {
      await consumeForOrder(tx, order.id);
      if (order.tableId) {
        await tx.tableSession.updateMany({
          where: { tableId: order.tableId, status: "OPEN" },
          data: { status: "CLOSED", closedAt: new Date() },
        });
        await tx.restaurantTable.update({
          where: { id: order.tableId },
          data: { status: "NEEDS_CLEANING", version: { increment: 1 } },
        });
      }
    }
    return updated;
  });

  // Receipt: rendered with the configurable template for the POS response;
  // printing happens fire-and-forget so a printer failure never delays the
  // cashier (spec §6.5).
  let receiptPreview = "";
  try {
    receiptPreview = (await receiptTextForOrder(order.id)).text;
  } catch (err) {
    console.error("[payment] receipt render failed", err);
  }
  if (completes) autoPrintReceipt(order.id, { restaurantId: order.restaurantId, actorId: input.actorId });

  await audit({
    restaurantId: order.restaurantId,
    userId: input.actorId,
    orderId: order.id,
    action: completes ? "ORDER_PAID" : "ORDER_PARTIAL_PAYMENT",
    entityType: "Order",
    entityId: order.id,
    after: { amountPaid: result.amountPaid.toString(), completes },
  });
  emitToWorkspace(EVENTS.ORDER_COMPLETED, { id: order.id, orderNumber: order.orderNumber, completes });
  if (order.tableId) emitToWorkspace(EVENTS.TABLE_UPDATED, { tableId: order.tableId, status: "NEEDS_CLEANING" });
  if (splitMarkedPaid) emitToWorkspace(EVENTS.ORDER_UPDATED, { id: order.id, splitPaid: split!.id });

  return { ...result, receiptPreview };
}

export interface RefundInput {
  orderId: string;
  actorId: string;
  amount?: number;
  /** Line-level refund: quantities per order line (amount is derived). */
  lines?: RefundLineSelection[];
  reason: string;
  managerPin: string;
  restock?: boolean;
  idempotencyKey?: string | null;
}

export async function refundOrder(input: RefundInput) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: {
      payments: { where: { status: "SUCCEEDED" }, include: { refunds: true } },
      lines: { include: { menuItem: { include: { recipeLines: { where: { effectiveTo: null }, include: { ingredient: true } } } } } },
    },
  });
  if (!order) throw ApiError.notFound("Order not found");

  const manager = await verifyManagerPin(order.restaurantId, input.managerPin, input.actorId);

  const activeLines = order.lines.filter((l) => !l.isVoided);
  const priorRefunds = order.payments.flatMap((p) => p.refunds);
  const priorByLine = priorRefundedQtyByLine(priorRefunds.map((r) => r.refundedLines));

  let requested: number;
  let lineSnapshot: RefundedLineSnapshot[] | null = null;
  if (input.lines && input.lines.length > 0) {
    const plan = planLineRefund(
      activeLines.map((l) => ({ id: l.id, quantity: l.quantity, lineTotalCents: toCents(l.lineTotal) })),
      priorByLine,
      input.lines,
    );
    if (!plan.ok) throw ApiError.badRequest(plan.message);
    requested = plan.amountCents;
    lineSnapshot = plan.snapshot;
  } else {
    requested = toCents(input.amount ?? 0);
  }
  if (requested <= 0) throw ApiError.badRequest("Refund amount must be positive");

  const paid = order.payments.reduce((s, p) => s + toCents(p.amount), 0);
  const refundedSoFar = priorRefunds.reduce((s, r) => s + toCents(r.amount), 0);
  if (requested > paid - refundedSoFar) {
    throw ApiError.badRequest("Refund exceeds the refundable balance of the order");
  }

  const priorByPayment = new Map<string, number>();
  for (const p of order.payments) {
    priorByPayment.set(p.id, p.refunds.reduce((s, r) => s + toCents(r.amount), 0));
  }

  const result = await prisma.$transaction(async (tx) => {
    // Distribute the refund across successful payments (oldest first), never
    // exceeding what is still refundable on each payment.
    let remaining = requested;
    let firstRow = true;
    for (const p of order.payments) {
      if (remaining <= 0) break;
      const cap = Math.max(0, toCents(p.amount) - (priorByPayment.get(p.id) ?? 0));
      const amt = Math.min(remaining, cap);
      if (amt <= 0) continue;
      await tx.refund.create({
        data: {
          paymentId: p.id,
          orderId: order.id,
          amount: fromCents(amt),
          reason: input.reason,
          approvedBy: manager.id,
          restockItems: input.restock ?? false,
          // The per-line breakdown is stored once; totals aggregate fine.
          refundedLines: firstRow && lineSnapshot ? (lineSnapshot as unknown as Prisma.InputJsonValue) : undefined,
        },
      });
      firstRow = false;
      if (p.method === "CASH" && p.shiftId) {
        await tx.cashMovement.create({
          data: {
            shiftId: p.shiftId,
            type: "CASH_REFUND",
            amount: fromCents(amt),
            direction: "OUT",
            reference: order.id,
            reason: input.reason,
            actorId: input.actorId,
          },
        });
      }
      remaining -= amt;
    }
    if (remaining > 0) throw ApiError.conflict("Refund cannot be allocated across this order's payments");

    const totalRefunded = refundedSoFar + requested;
    const status = totalRefunded >= paid ? "REFUNDED" : "PARTIALLY_REFUNDED";

    if (input.restock) {
      const ratio = paid > 0 ? requested / paid : 0;
      for (const line of activeLines) {
        const refundedQty = lineSnapshot
          ? lineSnapshot.filter((s) => s.lineId === line.id).reduce((s, e) => s + e.quantity, 0)
          : line.quantity * ratio;
        for (const recipe of line.menuItem.recipeLines) {
          const back = Number(recipe.quantity) * refundedQty;
          if (back <= 0) continue;
          await tx.ingredient.update({
            where: { id: recipe.ingredientId },
            data: { currentStock: (Number(recipe.ingredient.currentStock) + back).toFixed(4) },
          });
          await tx.stockMovement.create({
            data: {
              restaurantId: recipe.ingredient.restaurantId,
              ingredientId: recipe.ingredientId,
              type: "RETURN",
              quantity: back.toFixed(4),
              reference: order.id,
              reason: `Refund restock: ${input.reason}`,
              actorId: input.actorId,
            },
          });
        }
      }
    }

    return tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: status },
    });
  });

  await audit({
    restaurantId: order.restaurantId,
    userId: input.actorId,
    orderId: order.id,
    action: "ORDER_REFUNDED",
    entityType: "Order",
    entityId: order.id,
    after: { amount: fromCents(requested), lines: lineSnapshot ?? undefined },
    reason: input.reason,
    approvedBy: manager.id,
  });
  emitToWorkspace(EVENTS.ORDER_UPDATED, { id: order.id, status: result.paymentStatus });
  return { ...result, refundedAmount: fromCents(requested), refundedLines: lineSnapshot };
}

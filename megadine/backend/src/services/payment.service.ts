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

/** True when Prisma reports a unique-constraint violation (P2002). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

const orderWithPayments = { lines: { include: { modifiers: true } }, payments: true } as const;

type LockedOrder = Prisma.OrderGetPayload<{ include: typeof orderWithPayments }>;

/**
 * Resolve the drawer that must receive this cash tender. Cash always needs an
 * open shift owned by the person taking it; a closed or someone else's shift is
 * never accepted (F-17).
 */
async function resolveCashShift(
  tx: Prisma.TransactionClient,
  input: { shiftId?: string | null; orderShiftId?: string | null; restaurantId: string; actorId: string },
): Promise<string> {
  const validate = async (id: string) => {
    const shift = await tx.cashShift.findUnique({ where: { id } });
    if (!shift || shift.restaurantId !== input.restaurantId) throw ApiError.badRequest("Shift not found");
    if (shift.status !== "OPEN") throw ApiError.conflict("Cash shift is not open");
    if (shift.cashierId !== input.actorId) throw ApiError.forbidden("Cash must be taken on your own shift");
    return shift.id;
  };

  if (input.shiftId) return validate(input.shiftId);

  const own = await tx.cashShift.findFirst({
    where: { restaurantId: input.restaurantId, cashierId: input.actorId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });
  if (own) return validate(own.id);

  if (input.orderShiftId) {
    const orderShift = await tx.cashShift.findUnique({ where: { id: input.orderShiftId } });
    if (orderShift?.status === "OPEN" && orderShift.cashierId === input.actorId) return validate(orderShift.id);
  }

  throw ApiError.badRequest("Open a cash shift before taking cash");
}

export async function payOrder(input: PayOrderInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      return prisma.order.findUnique({ where: { id: existing.orderId }, include: orderWithPayments });
    }
  }

  const initial = await prisma.order.findUnique({ where: { id: input.orderId }, select: { restaurantId: true } });
  if (!initial) throw ApiError.notFound("Order not found");

  let outcome: { order: LockedOrder; replayed: boolean; completes: boolean; tableId: string | null };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      // One writer at a time per order: a second terminal waits here and then
      // re-reads the balance instead of paying the same bill twice (F-11).
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
      if (!locked.length) throw ApiError.notFound("Order not found");

      // A retry can arrive after the first request committed but before its
      // response reached the client: replay the original instead of "already paid".
      if (input.idempotencyKey) {
        const existing = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) {
          const replay = await tx.order.findUnique({ where: { id: existing.orderId }, include: orderWithPayments });
          if (replay) return { order: replay, replayed: true, completes: false, tableId: replay.tableId };
        }
      }

      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: { ...orderWithPayments, tableSession: true },
      });
      if (!order) throw ApiError.notFound("Order not found");
      if (order.status === "CANCELLED") throw ApiError.conflict("Order is cancelled");
      if (order.paymentStatus === "SUCCEEDED") throw ApiError.conflict("Order already paid");

      const split = input.splitId ? await tx.orderSplit.findUnique({ where: { id: input.splitId } }) : null;
      if (input.splitId && (!split || split.orderId !== order.id)) throw ApiError.notFound("Split not found");
      if (split?.paid) throw ApiError.conflict("This person's bill is already paid");

      const total = toCents(order.total);
      const alreadyPaid = order.payments
        .filter((p) => p.status === "SUCCEEDED")
        .reduce((s, p) => s + toCents(p.amount), 0);
      const due = total - alreadyPaid;
      if (due <= 0) throw ApiError.conflict("Order already paid");

      const hasCash = input.payments.some((p) => p.method === "CASH");
      const cashShiftId = hasCash
        ? await resolveCashShift(tx, {
            shiftId: input.shiftId,
            orderShiftId: order.shiftId,
            restaurantId: order.restaurantId,
            actorId: input.actorId,
          })
        : input.shiftId ?? order.shiftId ?? null;

      // Non-cash tenders may never exceed the balance; cash may, and the excess
      // becomes change. This also stops a typo such as paying 1,000,000.
      const nonCashTotal = input.payments
        .filter((p) => p.method !== "CASH")
        .reduce((s, p) => s + toCents(p.amount), 0);
      if (nonCashTotal > due) throw ApiError.badRequest("Payment exceeds the amount due");

      let remaining = due - nonCashTotal;
      let changeCents = 0;
      const rows: { tender: TenderInput; amountCents: number; receivedCents: number | null; changeCents: number }[] = [];
      for (const p of input.payments) {
        const amountCents = toCents(p.amount);
        if (amountCents <= 0) throw ApiError.badRequest("Payment amount must be positive");
        if (p.method !== "CASH") {
          rows.push({ tender: p, amountCents, receivedCents: null, changeCents: 0 });
          continue;
        }
        const applied = Math.min(amountCents, remaining);
        const received = toCents(p.cashReceived ?? p.amount);
        if (received < applied) throw ApiError.badRequest("Cash received is less than the amount due");
        const change = received - applied;
        changeCents += change;
        remaining -= applied;
        rows.push({ tender: p, amountCents: applied, receivedCents: received, changeCents: change });
      }

      const appliedTotal = rows.reduce((s, r) => s + r.amountCents, 0);
      if (appliedTotal <= 0) throw ApiError.badRequest("Payment amount must be positive");
      const newPaid = alreadyPaid + appliedTotal;
      const completes = newPaid >= total;

      let firstPaymentId: string | null = null;
      for (const row of rows) {
        const createdPayment = await tx.payment.create({
          data: {
            orderId: order.id,
            method: row.tender.method,
            amount: fromCents(row.amountCents),
            status: "SUCCEEDED",
            reference: row.tender.reference ?? null,
            cashierId: input.actorId,
            shiftId: cashShiftId,
            cashReceived: row.tender.method === "CASH" ? fromCents(row.receivedCents ?? row.amountCents) : null,
            changeGiven: row.tender.method === "CASH" ? fromCents(row.changeCents) : null,
            idempotencyKey: input.payments.length === 1 ? input.idempotencyKey ?? null : null,
          },
        });
        firstPaymentId ??= createdPayment.id;
        if (row.tender.method === "CASH" && cashShiftId && row.amountCents > 0) {
          await tx.cashMovement.create({
            data: {
              shiftId: cashShiftId,
              type: "CASH_SALE",
              amount: fromCents(row.amountCents),
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
          ...(hasCash && !order.shiftId && cashShiftId ? { shiftId: cashShiftId } : {}),
          ...(completes ? { status: "COMPLETED", completedAt: new Date() } : {}),
        },
        include: orderWithPayments,
      });

      if (split && appliedTotal >= toCents(split.total)) {
        await tx.orderSplit.update({
          where: { id: split.id },
          data: { paid: true, paidAt: new Date(), paymentId: firstPaymentId },
        });
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
      return { order: updated, replayed: false, completes, tableId: order.tableId };
    });
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const existing = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        const replay = await prisma.order.findUnique({ where: { id: existing.orderId }, include: orderWithPayments });
        if (replay) return replay;
      }
    }
    throw err;
  }

  const order = outcome.order;
  if (outcome.replayed) return order;

  // Receipt: rendered with the configurable template for the POS response;
  // printing happens fire-and-forget so a printer failure never delays the
  // cashier (spec §6.5).
  let receiptPreview = "";
  try {
    receiptPreview = (await receiptTextForOrder(order.id)).text;
  } catch (err) {
    console.error("[payment] receipt render failed", err);
  }
  if (outcome.completes) autoPrintReceipt(order.id, { restaurantId: order.restaurantId, actorId: input.actorId });

  await audit({
    restaurantId: order.restaurantId,
    userId: input.actorId,
    orderId: order.id,
    action: outcome.completes ? "ORDER_PAID" : "ORDER_PARTIAL_PAYMENT",
    entityType: "Order",
    entityId: order.id,
    after: { amountPaid: order.amountPaid.toString(), completes: outcome.completes },
  });
  emitToWorkspace(EVENTS.ORDER_COMPLETED, { id: order.id, orderNumber: order.orderNumber, completes: outcome.completes });
  if (outcome.tableId) emitToWorkspace(EVENTS.TABLE_UPDATED, { tableId: outcome.tableId, status: "NEEDS_CLEANING" });

  return { ...order, receiptPreview };
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
          actorId: input.actorId,
          shiftId: p.shiftId ?? null,
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

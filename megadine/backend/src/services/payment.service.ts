import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { fromCents, toCents } from "../lib/money.js";
import { audit } from "../lib/audit.js";
import { verifyManagerPin } from "../lib/approval.js";
import { EVENTS, emitToWorkspace } from "../lib/socket.js";
import { consumeForOrder } from "./inventory.service.js";
import { autoPrintReceipt, receiptTextForOrder } from "./receipt.service.js";
import type { PaymentMethod } from "@prisma/client";

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

  const result = await prisma.$transaction(async (tx) => {
    for (const p of input.payments) {
      await tx.payment.create({
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

  return { ...result, receiptPreview };
}

export interface RefundInput {
  orderId: string;
  actorId: string;
  amount: number;
  reason: string;
  managerPin: string;
  restock?: boolean;
  idempotencyKey?: string | null;
}

export async function refundOrder(input: RefundInput) {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { payments: { where: { status: "SUCCEEDED" } }, lines: true },
  });
  if (!order) throw ApiError.notFound("Order not found");

  const manager = await verifyManagerPin(order.restaurantId, input.managerPin, input.actorId);
  const requested = toCents(input.amount);
  if (requested <= 0) throw ApiError.badRequest("Refund amount must be positive");

  const alreadyRefunded = await prisma.refund.aggregate({
    where: { orderId: order.id },
    _sum: { amount: true },
  });
  const paid = order.payments.reduce((s, p) => s + toCents(p.amount), 0);
  const refundedSoFar = toCents(alreadyRefunded._sum.amount ?? 0);
  if (requested > paid - refundedSoFar) {
    throw ApiError.badRequest("Refund exceeds the refundable balance of the order");
  }

  const result = await prisma.$transaction(async (tx) => {
    // Distribute the refund across successful payments (oldest first).
    let remaining = requested;
    for (const p of order.payments) {
      if (remaining <= 0) break;
      const amt = Math.min(remaining, toCents(p.amount));
      await tx.refund.create({
        data: {
          paymentId: p.id,
          orderId: order.id,
          amount: fromCents(amt),
          reason: input.reason,
          approvedBy: manager.id,
          restockItems: input.restock ?? false,
        },
      });
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

    const totalRefunded = refundedSoFar + requested;
    const status = totalRefunded >= paid ? "REFUNDED" : "PARTIALLY_REFUNDED";

    if (input.restock) {
      const lines = await tx.orderLine.findMany({
        where: { orderId: order.id, isVoided: false },
        include: { menuItem: { include: { recipeLines: { where: { effectiveTo: null }, include: { ingredient: true } } } } },
      });
      const ratio = paid > 0 ? requested / paid : 0;
      for (const line of lines) {
        for (const recipe of line.menuItem.recipeLines) {
          const back = Number(recipe.quantity) * line.quantity * ratio;
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
    after: { amount: fromCents(requested) },
    reason: input.reason,
    approvedBy: manager.id,
  });
  emitToWorkspace(EVENTS.ORDER_UPDATED, { id: order.id, status: result.paymentStatus });
  return result;
}

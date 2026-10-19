import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { fromCents, toCents } from "../lib/money.js";
import { EVENTS, emitToWorkspace } from "../lib/socket.js";
import { computeSplitShares } from "./splitMath.js";

export interface SplitInput {
  personName: string;
  lineIds: string[];
}

export async function listOrderSplits(orderId: string) {
  return prisma.orderSplit.findMany({ where: { orderId }, orderBy: [{ createdAt: "asc" }, { personName: "asc" }] });
}

/**
 * Replace the whole split set for an order. Every active line must be
 * assigned to exactly one person; paid splits lock the bill (no re-splitting
 * after money changed hands).
 */
export async function setOrderSplits(orderId: string, actorId: string, splits: SplitInput[]) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lines: true, splits: true },
  });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    throw ApiError.conflict("Order is closed");
  }
  if (order.splits.some((s) => s.paid)) {
    throw ApiError.conflict("Cannot change the split after a person has paid");
  }

  const active = order.lines.filter((l) => !l.isVoided);
  const seen = new Map<string, number>();
  splits.forEach((s, index) => {
    for (const lineId of s.lineIds) {
      if (!active.some((l) => l.id === lineId)) {
        throw ApiError.badRequest("A selected item is not part of this order");
      }
      if (seen.has(lineId)) throw ApiError.badRequest("An item is assigned to more than one person");
      seen.set(lineId, index);
    }
  });
  if (active.some((l) => !seen.has(l.id))) {
    throw ApiError.badRequest("Assign every item to a person before saving");
  }

  const groupSubtotals = splits.map((s) =>
    s.lineIds.reduce((sum, id) => sum + toCents(active.find((l) => l.id === id)!.lineTotal), 0),
  );
  const shares = computeSplitShares(
    {
      subtotal: toCents(order.subtotal),
      discountAmount: toCents(order.discountAmount),
      serviceCharge: toCents(order.serviceCharge),
      taxAmount: toCents(order.taxAmount),
    },
    groupSubtotals,
  );

  const rows = await prisma.$transaction(async (tx) => {
    await tx.orderSplit.deleteMany({ where: { orderId } });
    for (let i = 0; i < splits.length; i += 1) {
      const split = splits[i]!;
      const share = shares[i]!;
      await tx.orderSplit.create({
        data: {
          orderId,
          personName: split.personName.trim(),
          lineIds: split.lineIds,
          subtotal: fromCents(share.subtotal),
          discount: fromCents(share.discount),
          serviceCharge: fromCents(share.serviceCharge),
          tax: fromCents(share.tax),
          total: fromCents(share.total),
        },
      });
    }
    return tx.orderSplit.findMany({ where: { orderId }, orderBy: [{ createdAt: "asc" }, { personName: "asc" }] });
  });

  await audit({
    restaurantId: order.restaurantId,
    userId: actorId,
    orderId,
    action: "ORDER_SPLIT_SET",
    entityType: "Order",
    entityId: orderId,
    after: { count: splits.length, persons: splits.map((s) => s.personName) },
  });
  emitToWorkspace(EVENTS.ORDER_UPDATED, { id: orderId, splits: splits.length });
  return rows;
}

export async function getOrderSplit(orderId: string, splitId: string) {
  const split = await prisma.orderSplit.findUnique({ where: { id: splitId } });
  if (!split || split.orderId !== orderId) throw ApiError.notFound("Split not found");
  return split;
}

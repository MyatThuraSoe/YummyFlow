import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { fromCents, toCents } from "../lib/money.js";
import { businessDateFor } from "../lib/businessDay.js";
import { audit } from "../lib/audit.js";
import { EVENTS, emitToWorkspace } from "../lib/socket.js";
import { getSettings } from "./order.service.js";

export interface OpenShiftInput {
  restaurantId: string;
  cashierId: string;
  terminalId?: string | null;
  openingFloat: number; // cents
}

export async function openShift(input: OpenShiftInput) {
  const settings = await getSettings(input.restaurantId);
  const businessDate = businessDateFor(new Date(), settings.businessDayCutoff);

  const conflict = await prisma.cashShift.findFirst({
    where: {
      restaurantId: input.restaurantId,
      status: "OPEN",
      OR: [{ cashierId: input.cashierId }, ...(input.terminalId ? [{ terminalId: input.terminalId }] : [])],
    },
  });
  if (conflict) throw ApiError.conflict("An open shift already exists for this cashier or terminal");

  const shift = await prisma.cashShift.create({
    data: {
      restaurantId: input.restaurantId,
      cashierId: input.cashierId,
      terminalId: input.terminalId ?? null,
      openingFloat: fromCents(input.openingFloat),
      businessDate,
      status: "OPEN",
    },
  });
  await audit({
    restaurantId: input.restaurantId,
    userId: input.cashierId,
    action: "SHIFT_OPENED",
    entityType: "CashShift",
    entityId: shift.id,
    after: { openingFloat: fromCents(input.openingFloat) },
  });
  emitToWorkspace(EVENTS.SHIFT_UPDATED, { shiftId: shift.id, status: "OPEN" });
  return shift;
}

export interface MovementInput {
  shiftId: string;
  actorId: string;
  type: "PAID_IN" | "PAID_OUT" | "SAFE_DROP";
  amount: number; // cents, positive
  reason?: string;
}

export async function addCashMovement(input: MovementInput) {
  const shift = await prisma.cashShift.findUnique({ where: { id: input.shiftId } });
  if (!shift) throw ApiError.notFound("Shift not found");
  if (shift.status !== "OPEN") throw ApiError.conflict("Shift is not open");
  const direction = input.type === "PAID_IN" ? "IN" : "OUT";
  const movement = await prisma.cashMovement.create({
    data: {
      shiftId: shift.id,
      type: input.type,
      amount: fromCents(input.amount),
      direction,
      reason: input.reason,
      actorId: input.actorId,
    },
  });
  await audit({
    restaurantId: shift.restaurantId,
    userId: input.actorId,
    action: `SHIFT_${input.type}`,
    entityType: "CashShift",
    entityId: shift.id,
    after: { amount: fromCents(input.amount) },
    reason: input.reason ?? null,
  });
  return movement;
}

export async function shiftSummary(shiftId: string) {
  const shift = await prisma.cashShift.findUnique({ where: { id: shiftId } });
  if (!shift) throw ApiError.notFound("Shift not found");
  const movements = await prisma.cashMovement.findMany({ where: { shiftId } });
  const payments = await prisma.payment.findMany({
    where: { shiftId, status: "SUCCEEDED" },
    include: { order: { select: { orderNumber: true, channel: true } } },
  });
  const refunds = await prisma.refund.findMany({
    where: { payment: { shiftId } },
  });

  const sum = (type: string, dir: "IN" | "OUT") =>
    movements.filter((m) => m.type === type && m.direction === dir).reduce((s, m) => s + toCents(m.amount), 0);

  const cashSales = sum("CASH_SALE", "IN");
  const cashRefunds = sum("CASH_REFUND", "OUT");
  const paidIn = sum("PAID_IN", "IN");
  const paidOut = sum("PAID_OUT", "OUT");
  const safeDrops = sum("SAFE_DROP", "OUT");
  const expectedCash =
    toCents(shift.openingFloat) + cashSales - cashRefunds + paidIn - paidOut - safeDrops;

  const byMethod: Record<string, number> = {};
  for (const p of payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + toCents(p.amount);

  const refundTotal = refunds.reduce((s, r) => s + toCents(r.amount), 0);
  const orderIds = new Set(payments.map((p) => p.orderId));
  const orders = await prisma.order.findMany({
    where: { id: { in: [...orderIds] } },
    select: { subtotal: true, taxAmount: true, discountAmount: true, serviceCharge: true, total: true },
  });
  const totals = orders.reduce(
    (acc, o) => ({
      gross: acc.gross + toCents(o.total),
      subtotal: acc.subtotal + toCents(o.subtotal),
      tax: acc.tax + toCents(o.taxAmount),
      discounts: acc.discounts + toCents(o.discountAmount),
      service: acc.service + toCents(o.serviceCharge),
    }),
    { gross: 0, subtotal: 0, tax: 0, discounts: 0, service: 0 },
  );

  return {
    shift,
    orderCount: orderIds.size,
    openingFloat: toCents(shift.openingFloat),
    cashSales,
    cashRefunds,
    paidIn,
    paidOut,
    safeDrops,
    expectedCash,
    byMethod,
    refundTotal,
    totals,
    payments: payments.length,
  };
}

export interface CloseShiftInput {
  shiftId: string;
  actorId: string;
  actualCash: number; // cents
  notes?: string;
  managerPin?: string;
}

export async function closeShift(input: CloseShiftInput) {
  const summary = await shiftSummary(input.shiftId);
  if (summary.shift.status !== "OPEN") throw ApiError.conflict("Shift is already closed");

  const variance = input.actualCash - summary.expectedCash;
  const updated = await prisma.cashShift.update({
    where: { id: input.shiftId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      expectedCash: fromCents(summary.expectedCash),
      actualCash: fromCents(input.actualCash),
      variance: fromCents(variance),
      closeNotes: input.notes,
    },
  });
  await audit({
    restaurantId: summary.shift.restaurantId,
    userId: input.actorId,
    action: "SHIFT_CLOSED",
    entityType: "CashShift",
    entityId: input.shiftId,
    after: { expectedCash: fromCents(summary.expectedCash), actualCash: fromCents(input.actualCash), variance: fromCents(variance) },
  });
  emitToWorkspace(EVENTS.SHIFT_UPDATED, { shiftId: input.shiftId, status: "CLOSED" });
  return { shift: updated, summary, variance };
}

export async function currentOpenShift(restaurantId: string, cashierId?: string, terminalId?: string | null) {
  return prisma.cashShift.findFirst({
    where: {
      restaurantId,
      status: "OPEN",
      ...(cashierId ? { cashierId } : {}),
      ...(terminalId ? { terminalId } : {}),
    },
    orderBy: { openedAt: "desc" },
  });
}

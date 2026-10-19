import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { toCents } from "../lib/money.js";
import { businessDateFor, endOfDay, startOfDay } from "../lib/businessDay.js";
import { audit } from "../lib/audit.js";

export interface Range {
  from: Date;
  to: Date;
}

export async function dailySales(restaurantId: string, businessDate: Date) {
  const day = startOfDay(businessDate);
  const dayEnd = endOfDay(businessDate);

  const orders = await prisma.order.findMany({
    where: { restaurantId, businessDate: { gte: day, lte: dayEnd }, status: "COMPLETED" },
    include: {
      lines: { include: { menuItem: { include: { category: true } } } },
      payments: true,
      cashier: { select: { id: true, name: true } },
    },
  });
  const cancelled = await prisma.order.count({
    where: { restaurantId, businessDate: { gte: day, lte: dayEnd }, status: "CANCELLED" },
  });

  const dayOrderIds = await prisma.order.findMany({
    where: { restaurantId, businessDate: { gte: day, lte: dayEnd } },
    select: { id: true },
  });
  const refunds = await prisma.refund.findMany({
    where: { orderId: { in: dayOrderIds.map((o) => o.id) } },
  });

  const agg = orders.reduce(
    (a, o) => ({
      grossSales: a.grossSales + toCents(o.total),
      subtotal: a.subtotal + toCents(o.subtotal),
      tax: a.tax + toCents(o.taxAmount),
      serviceCharge: a.serviceCharge + toCents(o.serviceCharge),
      discounts: a.discounts + toCents(o.discountAmount),
      amountPaid: a.amountPaid + toCents(o.amountPaid),
    }),
    { grossSales: 0, subtotal: 0, tax: 0, serviceCharge: 0, discounts: 0, amountPaid: 0 },
  );
  const refundTotal = refunds.reduce((s, r) => s + toCents(r.amount), 0);
  const netSales = agg.subtotal - agg.discounts - refundTotal;

  const byMethod: Record<string, number> = {};
  for (const o of orders) for (const p of o.payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + toCents(p.amount);

  const byChannel: Record<string, number> = {};
  for (const o of orders) byChannel[o.channel] = (byChannel[o.channel] ?? 0) + toCents(o.total);

  const byCategory: Record<string, { qty: number; revenue: number }> = {};
  const byEmployee: Record<string, { name: string; orders: number; sales: number }> = {};
  for (const o of orders) {
    const empId = o.cashier?.id ?? "unknown";
    byEmployee[empId] ??= { name: o.cashier?.name ?? "Unknown", orders: 0, sales: 0 };
    byEmployee[empId].orders += 1;
    byEmployee[empId].sales += toCents(o.total);
    for (const l of o.lines) {
      if (l.isVoided) continue;
      const cat = l.menuItem.category.name;
      byCategory[cat] ??= { qty: 0, revenue: 0 };
      byCategory[cat].qty += l.quantity;
      byCategory[cat].revenue += toCents(l.lineTotal);
    }
  }

  const orderCount = orders.length;
  return {
    businessDate: day,
    orderCount,
    cancelledOrders: cancelled,
    ...agg,
    refundTotal,
    netSales,
    avgTicket: orderCount > 0 ? Math.round(agg.grossSales / orderCount) : 0,
    byMethod,
    byChannel,
    byCategory,
    byEmployee,
  };
}

export async function itemsReport(restaurantId: string, range: Range) {
  const lines = await prisma.orderLine.findMany({
    where: {
      isVoided: false,
      order: { restaurantId, status: "COMPLETED", businessDate: { gte: startOfDay(range.from), lte: endOfDay(range.to) } },
    },
    include: { menuItem: { include: { category: true } } },
  });
  const map: Record<string, { name: string; category: string; qty: number; revenue: number }> = {};
  for (const l of lines) {
    const key = l.menuItemId;
    map[key] ??= { name: l.itemNameSnapshot, category: l.menuItem.category.name, qty: 0, revenue: 0 };
    map[key].qty += l.quantity;
    map[key].revenue += toCents(l.lineTotal);
  }
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

export async function hourlyReport(restaurantId: string, range: Range) {
  const orders = await prisma.order.findMany({
    where: {
      restaurantId,
      status: "COMPLETED",
      businessDate: { gte: startOfDay(range.from), lte: endOfDay(range.to) },
    },
    select: { createdAt: true, total: true },
  });
  const buckets: Record<number, { orders: number; sales: number }> = {};
  for (const o of orders) {
    const h = o.createdAt.getHours();
    buckets[h] ??= { orders: 0, sales: 0 };
    buckets[h].orders += 1;
    buckets[h].sales += toCents(o.total);
  }
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    orders: buckets[h]?.orders ?? 0,
    sales: buckets[h]?.sales ?? 0,
  }));
}

export async function stockMovementReport(restaurantId: string, range: Range) {
  return prisma.stockMovement.findMany({
    where: {
      restaurantId,
      createdAt: { gte: startOfDay(range.from), lte: endOfDay(range.to) },
    },
    include: { ingredient: { select: { name: true, stockUnit: true } } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
}

export async function wastageReport(restaurantId: string, range: Range) {
  const movements = await prisma.stockMovement.findMany({
    where: {
      restaurantId,
      type: "WASTAGE",
      createdAt: { gte: startOfDay(range.from), lte: endOfDay(range.to) },
    },
    include: { ingredient: true },
  });
  const rows = movements.map((m) => ({
    ingredientName: m.ingredient.name,
    quantity: Math.abs(Number(m.quantity)),
    unit: m.ingredient.stockUnit,
    cost: Math.abs(Number(m.quantity)) * Number(m.unitCost ?? m.ingredient.costPerUnit),
    reason: m.reason,
    note: m.note,
    at: m.createdAt,
  }));

  const byReasonMap = new Map<string, { reason: string; quantity: number; cost: number }>();
  for (const r of rows) {
    const key = r.reason ?? "unspecified";
    const entry = byReasonMap.get(key) ?? { reason: key, quantity: 0, cost: 0 };
    entry.quantity += r.quantity;
    entry.cost += r.cost;
    byReasonMap.set(key, entry);
  }

  const byDayMap = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.at.getFullYear()}-${String(r.at.getMonth() + 1).padStart(2, "0")}-${String(r.at.getDate()).padStart(2, "0")}`;
    byDayMap.set(key, (byDayMap.get(key) ?? 0) + r.cost);
  }

  return {
    rows,
    totalCost: rows.reduce((s, r) => s + r.cost, 0),
    byReason: [...byReasonMap.values()].sort((a, b) => b.cost - a.cost),
    byDay: [...byDayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, cost]) => ({ date, cost })),
  };
}

export async function dashboard(restaurantId: string) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { businessDayCutoff: true },
  });
  const today = businessDateFor(new Date(), restaurant?.businessDayCutoff ?? "04:00");
  const [{ _sum, _count }, openShifts, lowStock, activeOrders] = await Promise.all([
    prisma.order.aggregate({
      where: { restaurantId, status: "COMPLETED", businessDate: today },
      _sum: { total: true },
      _count: true,
    }),
    prisma.cashShift.count({ where: { restaurantId, status: "OPEN" } }),
    prisma.ingredient.findMany({
      where: { restaurantId, isActive: true, reorderLevel: { not: null } },
      select: { currentStock: true, reorderLevel: true },
    }),
    prisma.order.count({ where: { restaurantId, status: { in: ["DRAFT", "SENT_TO_KITCHEN", "IN_PROGRESS", "READY"] } } }),
  ]);
  const lowStockCount = lowStock.filter((i) => Number(i.currentStock) <= Number(i.reorderLevel)).length;
  return {
    todaySales: toCents(_sum.total ?? 0),
    todayOrders: _count,
    openShifts,
    lowStockCount,
    activeOrders,
  };
}

/** Consolidated end-of-business-day (Z) report across all shifts. */
export async function zReport(restaurantId: string, businessDate: Date) {
  const day = startOfDay(businessDate);
  const dayEnd = endOfDay(businessDate);
  const base = await dailySales(restaurantId, businessDate);

  const shifts = await prisma.cashShift.findMany({
    where: { restaurantId, businessDate: { gte: day, lte: dayEnd } },
    include: { cashier: { select: { name: true } } },
    orderBy: { openedAt: "asc" },
  });
  const shiftIds = shifts.map((s) => s.id);
  const movements = await prisma.cashMovement.findMany({ where: { shiftId: { in: shiftIds } } });

  const sumMovement = (type: string) =>
    movements.filter((m) => m.type === type).reduce((s, m) => s + toCents(m.amount), 0);
  const openingFloat = shifts.reduce((s, sh) => s + toCents(sh.openingFloat), 0);
  const cashSales = sumMovement("CASH_SALE");
  const cashRefunds = sumMovement("CASH_REFUND");
  const paidIn = sumMovement("PAID_IN");
  const paidOut = sumMovement("PAID_OUT");
  const safeDrops = sumMovement("SAFE_DROP");
  const expectedCash = openingFloat + cashSales - cashRefunds + paidIn - paidOut - safeDrops;

  const expenses = await prisma.expense.findMany({
    where: { restaurantId, date: { gte: day, lte: dayEnd } },
    orderBy: { date: "desc" },
  });
  const expenseTotal = expenses.reduce((s, e) => s + toCents(e.amount), 0);

  const voidedLines = await prisma.orderLine.count({
    where: { isVoided: true, order: { restaurantId, businessDate: { gte: day, lte: dayEnd } } },
  });

  const closed = await prisma.businessDayClose.findUnique({
    where: { restaurantId_businessDate: { restaurantId, businessDate: day } },
  });

  return {
    ...base,
    voidedLines,
    shiftCount: shifts.length,
    openShifts: shifts.filter((s) => s.status === "OPEN").length,
    shifts: shifts.map((s) => ({
      id: s.id,
      cashier: s.cashier.name,
      status: s.status,
      openingFloat: toCents(s.openingFloat),
      expectedCash: s.expectedCash ? toCents(s.expectedCash) : null,
      actualCash: s.actualCash ? toCents(s.actualCash) : null,
      variance: s.variance ? toCents(s.variance) : null,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
    })),
    cash: { openingFloat, cashSales, cashRefunds, paidIn, paidOut, safeDrops, expectedCash },
    expenses: { total: expenseTotal, rows: expenses },
    closed: closed ? { id: closed.id, closedAt: closed.closedAt, variance: toCents(closed.variance) } : null,
  };
}

export async function closeBusinessDay(
  restaurantId: string,
  actorId: string,
  businessDate: Date,
  actualCash: number,
  notes?: string,
) {
  const day = startOfDay(businessDate);
  const existing = await prisma.businessDayClose.findUnique({
    where: { restaurantId_businessDate: { restaurantId, businessDate: day } },
  });
  if (existing) throw ApiError.conflict("Business day already closed");

  const report = await zReport(restaurantId, businessDate);
  const expectedCash = report.cash.expectedCash;
  const variance = actualCash - expectedCash;

  const close = await prisma.businessDayClose.create({
    data: {
      restaurantId,
      businessDate: day,
      closedById: actorId,
      report: report as unknown as object,
      expectedCash: expectedCash / 100,
      actualCash: actualCash / 100,
      variance: variance / 100,
      notes,
    },
  });
  await audit({
    restaurantId,
    userId: actorId,
    action: "BUSINESS_DAY_CLOSED",
    entityType: "BusinessDayClose",
    entityId: close.id,
    after: { businessDate: day.toISOString(), expectedCash: expectedCash / 100, actualCash: actualCash / 100, variance: variance / 100 },
  });
  return { close, report, variance };
}

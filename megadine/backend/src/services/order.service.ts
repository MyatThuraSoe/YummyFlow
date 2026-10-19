import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { computeOrderTotals, lineTotalCents, toDb } from "../lib/calculations.js";
import { fromCents, toCents } from "../lib/money.js";
import { businessDateFor } from "../lib/businessDay.js";
import { audit } from "../lib/audit.js";
import { verifyManagerPin } from "../lib/approval.js";
import { EVENTS, emitToWorkspace, emitToRole } from "../lib/socket.js";
import { sendToPrinter, buildKitchenTicketText } from "../lib/printers.js";
import { env } from "../lib/env.js";
import { consumeForOrder } from "./inventory.service.js";
import type { OrderChannel, OrderPriority, Prisma, Station } from "@prisma/client";

export interface NewLineInput {
  menuItemId: string;
  quantity: number;
  variantId?: string | null;
  modifierOptionIds?: string[];
  notes?: string | null;
  lineDiscount?: number; // absolute amount
}

export interface CreateOrderInput {
  restaurantId: string;
  actorId: string;
  channel: OrderChannel;
  tableId?: string | null;
  terminalId?: string | null;
  shiftId?: string | null;
  items: NewLineInput[];
  orderDiscount?: number; // absolute amount
  pickupName?: string | null;
  pickupTime?: Date | null;
  notes?: string | null;
  idempotencyKey?: string | null;
}

export async function getSettings(restaurantId: string) {
  const r = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!r) throw ApiError.notFound("Restaurant not found");
  return {
    id: r.id,
    name: r.name,
    currency: r.currency,
    taxRate: Number(r.taxRate),
    taxInclusive: r.taxInclusive,
    serviceChargePct: Number(r.serviceChargePct),
    businessDayCutoff: r.businessDayCutoff,
    receiptHeader: r.receiptHeader,
    receiptFooter: r.receiptFooter,
  };
}

async function nextOrderNumber(tx: Prisma.TransactionClient, restaurantId: string): Promise<number> {
  const last = await tx.order.findFirst({
    where: { restaurantId },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });
  return (last?.orderNumber ?? 1000) + 1;
}

async function buildLines(
  tx: Prisma.TransactionClient,
  items: NewLineInput[],
): Promise<{ data: Prisma.OrderLineCreateWithoutOrderInput[]; lineTotals: number[] }> {
  const data: Prisma.OrderLineCreateWithoutOrderInput[] = [];
  const lineTotals: number[] = [];

  for (const input of items) {
    const item = await tx.menuItem.findUnique({
      where: { id: input.menuItemId },
      include: { variants: true, modifierGroups: { include: { options: true } } },
    });
    if (!item || !item.isActive) throw ApiError.badRequest(`Menu item ${input.menuItemId} is unavailable`);
    if (!item.isAvailable) throw ApiError.conflict(`"${item.name}" is 86'd (out of stock)`);

    let unitCents = toCents(item.price);
    let variantSnapshot: string | null = null;
    if (input.variantId) {
      const variant = item.variants.find((v) => v.id === input.variantId);
      if (!variant) throw ApiError.badRequest("Selected variant does not exist");
      if (!variant.isAvailable) throw ApiError.conflict(`Variant "${variant.name}" is unavailable`);
      unitCents += toCents(variant.priceAdjust);
      variantSnapshot = variant.name;
    }

    const selectedOptions = item.modifierGroups
      .flatMap((g) => g.options)
      .filter((o) => input.modifierOptionIds?.includes(o.id));
    for (const o of selectedOptions) {
      if (!o.isAvailable) throw ApiError.conflict(`Modifier "${o.name}" is unavailable`);
    }
    const modifierData = selectedOptions.map((o) => ({
      nameSnapshot: o.name,
      priceSnapshot: fromCents(toCents(o.price)),
      quantity: 1,
    }));
    const modifierCents = selectedOptions.reduce((s, o) => s + toCents(o.price), 0);

    const lineDiscountCents = input.lineDiscount ? toCents(input.lineDiscount) : 0;
    const lineTotal = lineTotalCents({
      unitPrice: fromCents(unitCents),
      quantity: input.quantity,
      modifiers: modifierData.map((m) => ({ price: m.priceSnapshot })),
      lineDiscount: fromCents(lineDiscountCents),
    });
    lineTotals.push(lineTotal);

    data.push({
      menuItem: { connect: { id: item.id } },
      itemNameSnapshot: variantSnapshot ? `${item.name} (${variantSnapshot})` : item.name,
      unitPriceSnapshot: fromCents(unitCents),
      stationSnapshot: item.station,
      variantSnapshot,
      quantity: input.quantity,
      lineDiscount: fromCents(lineDiscountCents),
      lineTotal: fromCents(lineTotal),
      notes: input.notes ?? null,
      modifiers: modifierData.length ? { createMany: { data: modifierData } } : undefined,
    });
    void modifierCents;
  }
  return { data, lineTotals };
}

export async function createOrder(input: CreateOrderInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { lines: { include: { modifiers: true } }, payments: true },
    });
    if (existing) return existing;
  }
  if (!input.items.length) throw ApiError.badRequest("Order must contain at least one item");

  const settings = await getSettings(input.restaurantId);
  const businessDate = businessDateFor(new Date(), settings.businessDayCutoff);

  const order = await prisma.$transaction(async (tx) => {
    const { data, lineTotals } = await buildLines(tx, input.items);
    const totals = computeOrderTotals(lineTotals, input.orderDiscount ? toCents(input.orderDiscount) : 0, {
      taxRate: settings.taxRate,
      taxInclusive: settings.taxInclusive,
      serviceChargePct: settings.serviceChargePct,
    });
    const orderNumber = await nextOrderNumber(tx, input.restaurantId);

    let tableSessionId: string | null = null;
    if (input.channel === "DINE_IN" && input.tableId) {
      const table = await tx.restaurantTable.findUnique({ where: { id: input.tableId } });
      if (!table) throw ApiError.badRequest("Table not found");
      const open = await tx.tableSession.findFirst({
        where: { tableId: input.tableId, status: "OPEN" },
        include: { order: { select: { id: true, orderNumber: true, status: true } } },
      });
      // Never silently detach an open order from its table: the cashier must
      // recall the existing order (and add round-2 items) instead.
      if (open?.order && open.order.status !== "COMPLETED" && open.order.status !== "CANCELLED") {
        throw ApiError.conflict(`Table already has an open order #${open.order.orderNumber}`);
      }
      tableSessionId = open?.id ?? null;
    }

    const created = await tx.order.create({
      data: {
        restaurantId: input.restaurantId,
        orderNumber,
        channel: input.channel,
        status: "DRAFT",
        tableId: input.tableId ?? null,
        terminalId: input.terminalId ?? null,
        cashierId: input.actorId,
        shiftId: input.shiftId ?? null,
        pickupName: input.pickupName ?? null,
        pickupTime: input.pickupTime ?? null,
        notes: input.notes ?? null,
        businessDate,
        idempotencyKey: input.idempotencyKey ?? null,
        ...toDb(totals),
        lines: { create: data },
      },
      include: { lines: { include: { modifiers: true } }, payments: true },
    });

    if (input.channel === "DINE_IN" && input.tableId) {
      if (tableSessionId) {
        await tx.tableSession.update({ where: { id: tableSessionId }, data: { orderId: created.id } });
      } else {
        await tx.tableSession.create({ data: { tableId: input.tableId, orderId: created.id, status: "OPEN" } });
        await tx.restaurantTable.update({
          where: { id: input.tableId },
          data: { status: "OCCUPIED", version: { increment: 1 } },
        });
      }
    }

    return created;
  });

  await audit({
    restaurantId: input.restaurantId,
    userId: input.actorId,
    orderId: order.id,
    action: "ORDER_CREATED",
    entityType: "Order",
    entityId: order.id,
    after: { orderNumber: order.orderNumber, total: order.total.toString() },
  });
  emitToWorkspace(EVENTS.ORDER_CREATED, { id: order.id, orderNumber: order.orderNumber });
  emitToRole("KITCHEN", EVENTS.ORDER_CREATED, { id: order.id, orderNumber: order.orderNumber });
  return order;
}

export async function recalcOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lines: true, restaurant: true },
  });
  if (!order) throw ApiError.notFound("Order not found");
  const active = order.lines.filter((l) => !l.isVoided);
  const lineTotals = active.map((l) => toCents(l.lineTotal));
  const totals = computeOrderTotals(lineTotals, toCents(order.discountAmount), {
    taxRate: Number(order.restaurant.taxRate),
    taxInclusive: order.restaurant.taxInclusive,
    serviceChargePct: Number(order.restaurant.serviceChargePct),
  });
  return prisma.order.update({ where: { id: orderId }, data: toDb(totals) });
}

export async function addItemsToOrder(
  orderId: string,
  actorId: string,
  items: NewLineInput[],
) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { restaurant: true } });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    throw ApiError.conflict("Cannot modify a completed or cancelled order");
  }
  await prisma.$transaction(async (tx) => {
    const { data } = await buildLines(tx, items);
    for (const line of data) {
      await tx.orderLine.create({ data: { ...line, order: { connect: { id: orderId } } } });
    }
  });
  const updated = await recalcOrder(orderId);
  await audit({
    restaurantId: order.restaurantId,
    userId: actorId,
    orderId,
    action: "ORDER_ITEMS_ADDED",
    entityType: "Order",
    entityId: orderId,
    after: { count: items.length },
  });
  emitToWorkspace(EVENTS.ORDER_UPDATED, { id: orderId });
  return updated;
}

export async function voidOrderLine(
  orderId: string,
  lineId: string,
  actorId: string,
  actorRole: string,
  reason: string,
  managerPin?: string,
) {
  const line = await prisma.orderLine.findUnique({ where: { id: lineId }, include: { order: true } });
  if (!line || line.orderId !== orderId) throw ApiError.notFound("Order line not found");
  if (line.isVoided) throw ApiError.conflict("Line already voided");

  let approvedBy: string | null = null;
  // A line already sent to the kitchen is a sensitive void → manager must approve.
  const sent = await prisma.kitchenTicketLine.findFirst({ where: { orderLineId: lineId } });
  if (sent && actorRole !== "OWNER" && actorRole !== "ADMIN") {
    const manager = await verifyManagerPin(line.order.restaurantId, managerPin ?? "", actorId);
    approvedBy = manager.id;
  }

  await prisma.orderLine.update({
    where: { id: lineId },
    data: { isVoided: true, voidReason: reason },
  });
  const updated = await recalcOrder(orderId);
  await audit({
    restaurantId: line.order.restaurantId,
    userId: actorId,
    orderId,
    action: "ORDER_LINE_VOIDED",
    entityType: "OrderLine",
    entityId: lineId,
    before: { lineTotal: line.lineTotal.toString() },
    reason,
    approvedBy,
  });
  emitToWorkspace(EVENTS.ORDER_UPDATED, { id: orderId });
  return updated;
}

export async function applyDiscount(
  orderId: string,
  actorId: string,
  actorRole: string,
  input: { type: "PERCENT" | "ABSOLUTE"; value: number; managerPin?: string; reason?: string },
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lines: true, restaurant: true },
  });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    throw ApiError.conflict("Cannot discount a completed or cancelled order");
  }

  const active = order.lines.filter((l) => !l.isVoided);
  const subtotal = active.reduce((s, l) => s + toCents(l.lineTotal), 0);
  const amount =
    input.type === "PERCENT" ? Math.round(subtotal * (input.value / 100)) : toCents(input.value);
  const pct = subtotal > 0 ? amount / subtotal : 0;

  let approvedBy: string | null = null;
  const isManager = actorRole === "OWNER" || actorRole === "ADMIN";
  if (!isManager && pct > 0.1) {
    const manager = await verifyManagerPin(order.restaurantId, input.managerPin ?? "", actorId);
    approvedBy = manager.id;
  }

  const totals = computeOrderTotals(active.map((l) => toCents(l.lineTotal)), amount, {
    taxRate: Number(order.restaurant.taxRate),
    taxInclusive: order.restaurant.taxInclusive,
    serviceChargePct: Number(order.restaurant.serviceChargePct),
  });
  const updated = await prisma.order.update({ where: { id: orderId }, data: toDb(totals) });
  await audit({
    restaurantId: order.restaurantId,
    userId: actorId,
    orderId,
    action: "ORDER_DISCOUNT_APPLIED",
    entityType: "Order",
    entityId: orderId,
    before: { total: order.total.toString() },
    after: { total: updated.total.toString(), discount: updated.discountAmount.toString() },
    reason: input.reason ?? null,
    approvedBy,
  });
  emitToWorkspace(EVENTS.ORDER_UPDATED, { id: orderId });
  return updated;
}

/** Create kitchen tickets for any lines not yet sent, and print them. */
export async function sendToKitchen(orderId: string, actorId: string, actorRole: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      lines: { include: { modifiers: true, order: false } },
      restaurant: true,
      tableSession: { include: { table: true } },
    },
  });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    throw ApiError.conflict("Order is already closed");
  }

  const existingTickets = await prisma.kitchenTicket.findMany({
    where: { orderId },
    select: { lines: { select: { orderLineId: true } } },
  });
  const sentIds = new Set(existingTickets.flatMap((t) => t.lines.map((l) => l.orderLineId)));
  const pending = order.lines.filter((l) => !l.isVoided && !sentIds.has(l.id));
  if (!pending.length) return { tickets: 0, printed: [] as string[] };

  const byStation = new Map<Station, typeof pending>();
  for (const line of pending) {
    const arr = byStation.get(line.stationSnapshot) ?? [];
    arr.push(line);
    byStation.set(line.stationSnapshot, arr);
  }

  const printed: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const [station, lines] of byStation) {
      const ticket = await tx.kitchenTicket.create({
        data: {
          orderId,
          station,
          status: "QUEUED",
          lines: {
            createMany: {
              data: lines.map((l) => ({
                orderLineId: l.id,
                itemName: l.itemNameSnapshot,
                quantity: l.quantity,
                modifiers: l.modifiers.map((m) => ({ name: m.nameSnapshot, price: m.priceSnapshot.toString() })),
                notes: l.notes,
                status: "QUEUED" as const,
              })),
            },
          },
        },
        include: { lines: true },
      });

      const text = buildKitchenTicketText({
        orderNumber: order.orderNumber,
        station,
        tableLabel: order.tableSession?.table?.name ?? (order.tableSession?.table?.number?.toString() ?? null),
        channel: order.channel,
        sentAt: ticket.sentAt,
        lines: ticket.lines.map((tl) => ({
          qty: tl.quantity,
          name: tl.itemName,
          modifiers: (tl.modifiers as { name: string }[] | null)?.map((m) => m.name) ?? [],
          notes: tl.notes,
        })),
      });
      const result = await sendToPrinter(env.KITCHEN_PRINTER_IP || null, text);
      printed.push(result.preview);

      emitToRole("KITCHEN", EVENTS.KITCHEN_NEW, {
        ticketId: ticket.id,
        orderNumber: order.orderNumber,
        station,
      });
    }
    await tx.order.update({
      where: { id: orderId },
      data: { status: order.status === "DRAFT" ? "SENT_TO_KITCHEN" : order.status },
    });
  });

  await audit({
    restaurantId: order.restaurantId,
    userId: actorId,
    orderId,
    action: "ORDER_SENT_TO_KITCHEN",
    entityType: "Order",
    entityId: orderId,
    after: { stations: [...byStation.keys()] },
    approvedBy: actorRole === "KITCHEN" ? actorId : null,
  });

  return { tickets: byStation.size, printed };
}

/** Waiter confirms the food actually reached the table (READY -> SERVED). */
export async function markOrderServed(orderId: string, actorId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status === "SERVED") return order;
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    throw ApiError.conflict("Order is already closed");
  }
  if (order.status !== "READY") {
    throw ApiError.conflict("Order is not ready to be served yet");
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({
      where: { id: orderId },
      data: { status: "SERVED", servedAt: now, servedBy: actorId },
      include: { lines: { include: { modifiers: true } }, payments: true },
    });
    for (const line of o.lines) {
      if (line.isVoided || line.servedQuantity >= line.quantity) continue;
      await tx.orderLine.update({
        where: { id: line.id },
        data: { servedQuantity: line.quantity, servedAt: line.servedAt ?? now },
      });
      line.servedQuantity = line.quantity;
    }
    if (o.tableId) {
      await tx.tableSession.updateMany({
        where: { tableId: o.tableId, status: "OPEN" },
        data: { servedAt: now },
      });
    }
    await consumeForOrder(tx, orderId);
    return o;
  });

  await audit({
    restaurantId: order.restaurantId,
    userId: actorId,
    orderId,
    action: "ORDER_SERVED",
    entityType: "Order",
    entityId: orderId,
  });
  emitToWorkspace(EVENTS.ORDER_UPDATED, { id: orderId, status: "SERVED" });
  return updated;
}

/**
 * Partial delivery: waiters confirm quantities per line. Quantities are
 * absolute totals (not deltas), so retries are idempotent. Once every active
 * line is fully served the order auto-transitions to SERVED.
 */
export async function serveOrderLines(
  orderId: string,
  actorId: string,
  entries: { lineId: string; quantity: number }[],
) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    throw ApiError.conflict("Order is already closed");
  }
  if (order.status === "DRAFT") {
    throw ApiError.conflict("Order has not been sent to the kitchen yet");
  }

  const byId = new Map(order.lines.map((l) => [l.id, l]));
  for (const entry of entries) {
    const line = byId.get(entry.lineId);
    if (!line || line.isVoided) throw ApiError.badRequest(`Unknown order line ${entry.lineId}`);
    if (!Number.isInteger(entry.quantity) || entry.quantity < 0 || entry.quantity > line.quantity) {
      throw ApiError.badRequest(`Served quantity for "${line.itemNameSnapshot}" must be between 0 and ${line.quantity}`);
    }
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const line = byId.get(entry.lineId)!;
      await tx.orderLine.update({
        where: { id: entry.lineId },
        data: { servedQuantity: entry.quantity, ...(entry.quantity > 0 ? { servedAt: line.servedAt ?? now } : {}) },
      });
    }
    const include = { lines: { include: { modifiers: true } }, payments: true } as const;
    let o = (await tx.order.findUnique({ where: { id: orderId }, include }))!;
    const activeLines = o.lines.filter((l) => !l.isVoided);
    const allServed = activeLines.length > 0 && activeLines.every((l) => l.servedQuantity >= l.quantity);
    let becameServed = false;
    if (allServed && o.status !== "SERVED") {
      o = await tx.order.update({
        where: { id: orderId },
        data: { status: "SERVED", servedAt: now, servedBy: actorId },
        include,
      });
      becameServed = true;
      if (o.tableId) {
        await tx.tableSession.updateMany({
          where: { tableId: o.tableId, status: "OPEN" },
          data: { servedAt: now },
        });
      }
      await consumeForOrder(tx, orderId);
    }
    return { order: o, becameServed };
  });

  await audit({
    restaurantId: order.restaurantId,
    userId: actorId,
    orderId,
    action: "ORDER_LINES_SERVED",
    entityType: "Order",
    entityId: orderId,
    after: { lines: entries, fullyServed: result.becameServed },
  });
  if (result.becameServed) {
    await audit({
      restaurantId: order.restaurantId,
      userId: actorId,
      orderId,
      action: "ORDER_SERVED",
      entityType: "Order",
      entityId: orderId,
    });
  }
  emitToWorkspace(EVENTS.ORDER_UPDATED, { id: orderId, status: result.order.status });
  return result.order;
}

/** Kitchen priority: RUSH > VIP > CATERING > NORMAL (manager approval to escalate). */
export async function setOrderPriority(
  orderId: string,
  actorId: string,
  actorRole: string,
  priority: OrderPriority,
  managerPin?: string,
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    throw ApiError.conflict("Cannot change priority on a closed order");
  }
  if (order.priority === priority) return order;

  let approvedBy: string | null = null;
  const isManager = actorRole === "OWNER" || actorRole === "ADMIN";
  if (!isManager && priority !== "NORMAL") {
    const manager = await verifyManagerPin(order.restaurantId, managerPin ?? "", actorId);
    approvedBy = manager.id;
  }

  const updated = await prisma.order.update({ where: { id: orderId }, data: { priority } });
  await audit({
    restaurantId: order.restaurantId,
    userId: actorId,
    orderId,
    action: "ORDER_PRIORITY_CHANGED",
    entityType: "Order",
    entityId: orderId,
    before: { priority: order.priority },
    after: { priority },
    approvedBy,
  });
  emitToWorkspace(EVENTS.ORDER_UPDATED, { id: orderId, priority });
  emitToRole("KITCHEN", EVENTS.KITCHEN_UPDATED, { orderId, priority });
  return updated;
}

export async function cancelOrder(
  orderId: string,
  actorId: string,
  actorRole: string,
  reason: string,
  managerPin?: string,
) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.status === "COMPLETED") throw ApiError.conflict("Cannot cancel a completed order; issue a refund instead");
  if (order.status === "CANCELLED") return order;

  let approvedBy: string | null = null;
  const sent = await prisma.kitchenTicket.count({ where: { orderId } });
  if ((sent > 0 || order.payments.length > 0) && actorRole !== "OWNER" && actorRole !== "ADMIN") {
    const manager = await verifyManagerPin(order.restaurantId, managerPin ?? "", actorId);
    approvedBy = manager.id;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    await tx.kitchenTicket.updateMany({
      where: { orderId, isCancelled: false },
      data: { isCancelled: true, cancelledAt: new Date(), status: "CANCELLED" },
    });
    if (o.tableId) {
      await tx.tableSession.updateMany({
        where: { tableId: o.tableId, status: "OPEN" },
        data: { status: "CLOSED", closedAt: new Date() },
      });
      await tx.restaurantTable.update({ where: { id: o.tableId }, data: { status: "NEEDS_CLEANING" } });
      emitToWorkspace(EVENTS.TABLE_UPDATED, { tableId: o.tableId, status: "NEEDS_CLEANING" });
    }
    return o;
  });

  await audit({
    restaurantId: order.restaurantId,
    userId: actorId,
    orderId,
    action: "ORDER_CANCELLED",
    entityType: "Order",
    entityId: orderId,
    reason,
    approvedBy,
  });
  emitToWorkspace(EVENTS.ORDER_UPDATED, { id: orderId, status: "CANCELLED" });
  return updated;
}

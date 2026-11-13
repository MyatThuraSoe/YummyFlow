import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { EVENTS, emitToRole, emitToWorkspace } from "../lib/socket.js";
import { recalcOrder } from "./order.service.js";
import { consumeForOrder } from "./inventory.service.js";
import { buildKitchenTicketText } from "../lib/printers.js";
import { queuePrint } from "../lib/printQueue.js";
import { decodePngDataUrl, pngToEscPos } from "../lib/bitmap.js";
import type { KitchenItemStatus, Station } from "@prisma/client";

const NEXT: Record<KitchenItemStatus, KitchenItemStatus | null> = {
  QUEUED: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
  SERVED: null,
  CANCELLED: null,
};

/** Most urgent first; keeps the KDS queue sorted by priority then age. */
const PRIORITY_RANK: Record<string, number> = { RUSH: 0, VIP: 1, CATERING: 2, NORMAL: 3 };

export async function listTickets(restaurantId: string, opts: { station?: Station; active?: boolean }) {
  const tickets = await prisma.kitchenTicket.findMany({
    where: {
      order: { restaurantId },
      ...(opts.station ? { station: opts.station } : {}),
      ...(opts.active ? { status: { in: ["QUEUED", "PREPARING", "READY"] } } : {}),
    },
    include: {
      lines: true,
      order: { select: { orderNumber: true, channel: true, tableId: true, notes: true, priority: true, cashier: { select: { name: true } } } },
    },
    orderBy: { sentAt: "asc" },
  });
  return tickets.sort((a, b) => {
    const rank = (PRIORITY_RANK[a.order.priority] ?? 9) - (PRIORITY_RANK[b.order.priority] ?? 9);
    return rank !== 0 ? rank : a.sentAt.getTime() - b.sentAt.getTime();
  });
}

export async function updateTicketStatus(
  ticketId: string,
  status: KitchenItemStatus,
  actorId: string,
  reason?: string,
) {
  const ticket = await prisma.kitchenTicket.findUnique({ where: { id: ticketId }, include: { order: true, lines: true } });
  if (!ticket) throw ApiError.notFound("Ticket not found");
  if (ticket.isCancelled) throw ApiError.conflict("Ticket is cancelled");

  if (status === "CANCELLED") {
    if (!reason || reason.trim().length < 2) throw ApiError.badRequest("A reason is required to cancel a kitchen ticket");
  }

  const allowed = status === "CANCELLED" || NEXT[ticket.status] === status || ticket.status === status;
  if (!allowed) throw ApiError.conflict(`Invalid transition ${ticket.status} -> ${status}`);

  const now = new Date();
  const updated = await prisma.kitchenTicket.update({
    where: { id: ticketId },
    data: {
      status,
      version: { increment: 1 },
      ...(status === "PREPARING" ? { preparingAt: now } : {}),
      ...(status === "READY" ? { readyAt: now } : {}),
      ...(status === "SERVED" ? { servedAt: now } : {}),
      ...(status === "CANCELLED" ? { cancelledAt: now, isCancelled: true } : {}),
      lines: { updateMany: { where: {}, data: { status } } },
    },
    include: { lines: true, order: true },
  });

  // Cancelling a kitchen ticket voids the billable lines it carried so the
  // customer is not charged for food that will not be served (F-15).
  if (status === "CANCELLED") {
    const lineIds = ticket.lines.map((l) => l.orderLineId).filter(Boolean);
    if (lineIds.length) {
      await prisma.orderLine.updateMany({
        where: { id: { in: lineIds }, isVoided: false },
        data: { isVoided: true, voidReason: reason ?? null },
      });
      await recalcOrder(ticket.orderId);
    }
    emitToRole("WAITER", EVENTS.KITCHEN_CANCELLED, {
      orderId: ticket.orderId,
      orderNumber: ticket.order.orderNumber,
      ticketId,
      reason: reason ?? null,
    });
    emitToWorkspace(EVENTS.ORDER_UPDATED, { id: ticket.orderId });
  }
  // orders that are already closed or confirmed as served by the waiter, and
  // never treat an all-cancelled line-up as "ready" (food was not served).
  const siblings = await prisma.kitchenTicket.findMany({ where: { orderId: ticket.orderId } });
  const active = siblings.filter((t) => t.status !== "CANCELLED");
  const rollable = ["DRAFT", "SENT_TO_KITCHEN", "IN_PROGRESS", "READY"].includes(ticket.order.status);
  const allReady = active.length > 0 && active.every((t) => t.status === "READY" || t.status === "SERVED");
  const allServed = active.length > 0 && active.every((t) => t.status === "SERVED");
  const justBecameReady = allReady && !["READY", "SERVED"].includes(ticket.order.status);
  if (allReady && rollable) {
    if (allServed) {
      // Kitchen confirmed everything reached the table: mark the order served
      // and deduct recipe ingredients exactly once.
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: ticket.orderId },
          data: { status: "SERVED", servedAt: now },
        });
        await consumeForOrder(tx, ticket.orderId);
      });
    } else {
      await prisma.order.update({ where: { id: ticket.orderId }, data: { status: "READY" } });
      if (justBecameReady) {
        emitToWorkspace(EVENTS.ORDER_ALL_READY, {
          orderId: ticket.orderId,
          orderNumber: ticket.order.orderNumber,
          tableId: ticket.order.tableId,
        });
      }
    }
  } else if (siblings.some((t) => t.status === "PREPARING") && rollable) {
    await prisma.order.update({ where: { id: ticket.orderId }, data: { status: "IN_PROGRESS" } });
  }

  await audit({
    restaurantId: ticket.order.restaurantId,
    userId: actorId,
    orderId: ticket.orderId,
    action: `KITCHEN_TICKET_${status}`,
    entityType: "KitchenTicket",
    entityId: ticketId,
    reason: reason ?? null,
  });
  emitToRole("KITCHEN", EVENTS.KITCHEN_UPDATED, { ticketId, status });
  emitToWorkspace(EVENTS.KITCHEN_UPDATED, { ticketId, status, orderNumber: ticket.order.orderNumber });
  return updated;
}

/**
 * Reprint a kitchen ticket on its station printer (F-14). The payload is
 * rebuilt from the stored ticket so a reprint always matches the ticket
 * content, even after a restart or a printer change.
 */
export async function reprintTicket(
  ticketId: string,
  actorId: string,
  restaurantId: string,
  image?: string | null,
) {
  const ticket = await prisma.kitchenTicket.findFirst({
    where: { id: ticketId, order: { restaurantId } },
    include: {
      lines: true,
      order: {
        include: {
          restaurant: { select: { timezone: true, ticketLanguage: true } },
          tableSession: { include: { table: { select: { number: true, name: true } } } },
        },
      },
    },
  });
  if (!ticket) throw ApiError.notFound("Ticket not found");

  const text = buildKitchenTicketText({
    orderNumber: ticket.order.orderNumber,
    station: ticket.station,
    round: ticket.round,
    tableLabel: ticket.order.tableSession?.table?.name ?? ticket.order.tableSession?.table?.number?.toString() ?? null,
    channel: ticket.order.channel,
    sentAt: ticket.sentAt,
    timeZone: ticket.order.restaurant.timezone,
    language: ticket.order.restaurant.ticketLanguage,
    lines: ticket.lines.map((tl) => ({
      qty: tl.quantity,
      name: tl.itemName,
      modifiers: (tl.modifiers as { name: string }[] | null)?.map((m) => m.name) ?? [],
      notes: tl.notes,
    })),
  });

  // Burmese/Thai script cannot be encoded by a single-byte code page; the
  // client renders the ticket to PNG with the tablet's fonts and we raster it.
  const png = image ? decodePngDataUrl(image) : null;
  const raster = png ? pngToEscPos(png) : null;

  const print = await queuePrint({
    restaurantId,
    orderId: ticket.orderId,
    ticketId: ticket.id,
    kind: "REPRINT",
    station: ticket.station,
    text,
    raster,
  });

  await audit({
    restaurantId,
    userId: actorId,
    orderId: ticket.orderId,
    action: "KITCHEN_TICKET_REPRINTED",
    entityType: "KitchenTicket",
    entityId: ticket.id,
  });

  return { job: print.job, result: print.result };
}

export async function toggleItemAvailability(
  menuItemId: string,
  isAvailable: boolean,
  actorId: string,
  reason?: string,
) {
  const item = await prisma.menuItem.findUnique({ where: { id: menuItemId }, include: { category: true } });
  if (!item) throw ApiError.notFound("Menu item not found");
  const updated = await prisma.menuItem.update({ where: { id: menuItemId }, data: { isAvailable } });
  await audit({
    restaurantId: item.category.restaurantId,
    userId: actorId,
    action: isAvailable ? "MENU_ITEM_AVAILABLE" : "MENU_ITEM_86",
    entityType: "MenuItem",
    entityId: menuItemId,
    reason: reason ?? null,
  });
  emitToWorkspace(EVENTS.MENU_ITEM_86, { menuItemId, isAvailable, name: item.name });
  return updated;
}

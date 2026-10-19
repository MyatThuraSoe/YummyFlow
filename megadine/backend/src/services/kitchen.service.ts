import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { EVENTS, emitToRole, emitToWorkspace } from "../lib/socket.js";
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
      order: { select: { orderNumber: true, channel: true, tableId: true, notes: true, priority: true } },
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
  const ticket = await prisma.kitchenTicket.findUnique({ where: { id: ticketId }, include: { order: true } });
  if (!ticket) throw ApiError.notFound("Ticket not found");
  if (ticket.isCancelled) throw ApiError.conflict("Ticket is cancelled");

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

  // Roll the order status up once every ticket is ready / served. Never touch
  // orders that are already closed or confirmed as served by the waiter, and
  // never treat an all-cancelled line-up as "ready" (food was not served).
  const siblings = await prisma.kitchenTicket.findMany({ where: { orderId: ticket.orderId } });
  const active = siblings.filter((t) => t.status !== "CANCELLED");
  const rollable = ["DRAFT", "SENT_TO_KITCHEN", "IN_PROGRESS", "READY"].includes(ticket.order.status);
  const allReady = active.length > 0 && active.every((t) => t.status === "READY" || t.status === "SERVED");
  const allServed = active.length > 0 && active.every((t) => t.status === "SERVED");
  if (allReady && rollable) {
    await prisma.order.update({
      where: { id: ticket.orderId },
      data: allServed
        ? { status: "SERVED", servedAt: now }
        : { status: "READY" },
    });
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

import { prisma } from "../lib/prisma.js";
import { EVENTS, emitToWorkspace } from "../lib/socket.js";

export const OVERDUE_WARN_MINUTES = 15;
export const OVERDUE_ESCALATE_MINUTES = 30;
export const RESERVATION_REMINDER_MINUTES = 15;

export interface OverdueInput {
  id: string;
  orderNumber: number;
  station: string;
  sentAt: Date;
}

export interface OverdueNotice {
  ticketId: string;
  orderNumber: number;
  station: string;
  minutes: number;
  band: "warn" | "overdue";
}

export function overdueBand(minutes: number): "warn" | "overdue" | null {
  if (minutes >= OVERDUE_ESCALATE_MINUTES) return "overdue";
  if (minutes >= OVERDUE_WARN_MINUTES) return "warn";
  return null;
}

/**
 * Tickets whose age band changed since the last sweep. `seenBands` maps a
 * ticket id to the last band that was notified so each escalation fires once.
 */
export function pickOverdueTickets(
  now: Date,
  tickets: OverdueInput[],
  seenBands: Map<string, string>,
): OverdueNotice[] {
  const notices: OverdueNotice[] = [];
  for (const ticket of tickets) {
    const minutes = Math.floor((now.getTime() - ticket.sentAt.getTime()) / 60000);
    const band = overdueBand(minutes);
    if (!band || seenBands.get(ticket.id) === band) continue;
    seenBands.set(ticket.id, band);
    notices.push({ ticketId: ticket.id, orderNumber: ticket.orderNumber, station: ticket.station, minutes, band });
  }
  return notices;
}

export interface ReservationInput {
  id: string;
  customerName: string;
  partySize: number;
  reservationTime: Date;
  tableNumber: number;
}

export interface ReservationNotice {
  reservationId: string;
  customerName: string;
  partySize: number;
  tableNumber: number;
  minutesUntil: number;
  time: string;
}

/** CONFIRMED reservations starting within the reminder window, notified once. */
export function pickReservationReminders(
  now: Date,
  reservations: ReservationInput[],
  reminded: Set<string>,
): ReservationNotice[] {
  const horizon = now.getTime() + RESERVATION_REMINDER_MINUTES * 60000;
  const notices: ReservationNotice[] = [];
  for (const res of reservations) {
    const start = res.reservationTime.getTime();
    if (start < now.getTime() || start > horizon || reminded.has(res.id)) continue;
    reminded.add(res.id);
    notices.push({
      reservationId: res.id,
      customerName: res.customerName,
      partySize: res.partySize,
      tableNumber: res.tableNumber,
      minutesUntil: Math.max(0, Math.ceil((start - now.getTime()) / 60000)),
      time: res.reservationTime.toISOString(),
    });
  }
  return notices;
}

const overdueBands = new Map<string, string>();
const remindedReservations = new Set<string>();

export async function sweepOverdueTickets(now = new Date()) {
  const tickets = await prisma.kitchenTicket.findMany({
    where: { status: { in: ["QUEUED", "PREPARING"] }, isCancelled: false },
    select: { id: true, station: true, sentAt: true, order: { select: { orderNumber: true } } },
  });
  const active = new Set(tickets.map((t) => t.id));
  for (const id of overdueBands.keys()) if (!active.has(id)) overdueBands.delete(id);

  const notices = pickOverdueTickets(
    now,
    tickets.map((t) => ({ id: t.id, orderNumber: t.order.orderNumber, station: t.station, sentAt: t.sentAt })),
    overdueBands,
  );
  for (const notice of notices) {
    emitToWorkspace(EVENTS.KITCHEN_OVERDUE, notice);
  }
  return notices.length;
}

export async function sweepReservationReminders(now = new Date()) {
  const reservations = await prisma.reservation.findMany({
    where: {
      status: "CONFIRMED",
      reservationTime: { gte: now, lte: new Date(now.getTime() + RESERVATION_REMINDER_MINUTES * 60000) },
    },
    include: { table: { select: { number: true } } },
  });
  const notices = pickReservationReminders(
    now,
    reservations.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      partySize: r.partySize,
      reservationTime: r.reservationTime,
      tableNumber: r.table.number,
    })),
    remindedReservations,
  );
  for (const notice of notices) {
    emitToWorkspace(EVENTS.RESERVATION_REMINDER, notice);
  }
  return notices.length;
}

/** Starts the 60s sweeps; returns a stop function (used by tests). */
export function startNotificationSchedulers(intervalMs = 60_000) {
  const overdueTimer = setInterval(() => void sweepOverdueTickets().catch(() => {}), intervalMs);
  const reservationTimer = setInterval(() => void sweepReservationReminders().catch(() => {}), intervalMs);
  overdueTimer.unref?.();
  reservationTimer.unref?.();
  return () => {
    clearInterval(overdueTimer);
    clearInterval(reservationTimer);
  };
}

import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { EVENTS, emitToWorkspace } from "../lib/socket.js";
import type { ReservationStatus } from "@prisma/client";

export interface ReservationInput {
  tableId: string;
  customerName: string;
  customerPhone?: string | null;
  partySize: number;
  reservationTime: Date;
  durationMinutes?: number;
  notes?: string | null;
}

async function assertTable(restaurantId: string, tableId: string) {
  const table = await prisma.restaurantTable.findFirst({ where: { id: tableId, restaurantId, isActive: true } });
  if (!table) throw ApiError.badRequest("Table not found");
  return table;
}

/** Reject overlapping bookings on the same table (doc §1.2 conflict detection). */
async function assertNoConflict(tableId: string, startsAt: Date, durationMinutes: number, excludeId?: string) {
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const candidates = await prisma.reservation.findMany({
    where: {
      tableId,
      status: { in: ["CONFIRMED", "SEATED"] satisfies ReservationStatus[] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  const clash = candidates.find((r) => {
    const rEnd = new Date(r.reservationTime.getTime() + r.durationMinutes * 60_000);
    return r.reservationTime < endsAt && startsAt < rEnd;
  });
  if (clash) {
    throw new ApiError(409, "RESERVATION_CONFLICT", "This table already has an overlapping reservation");
  }
}

export async function listReservations(
  restaurantId: string,
  opts: { from?: Date; to?: Date; tableId?: string; status?: ReservationStatus },
) {
  return prisma.reservation.findMany({
    where: {
      restaurantId,
      ...(opts.tableId ? { tableId: opts.tableId } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.from || opts.to
        ? { reservationTime: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } }
        : {}),
    },
    include: { table: { select: { number: true, name: true, zone: true } } },
    orderBy: { reservationTime: "asc" },
  });
}

export async function createReservation(restaurantId: string, actorId: string, input: ReservationInput) {
  await assertTable(restaurantId, input.tableId);
  const duration = input.durationMinutes ?? 90;
  await assertNoConflict(input.tableId, input.reservationTime, duration);

  const reservation = await prisma.reservation.create({
    data: {
      restaurantId,
      tableId: input.tableId,
      customerName: input.customerName,
      customerPhone: input.customerPhone ?? null,
      partySize: input.partySize,
      reservationTime: input.reservationTime,
      durationMinutes: duration,
      notes: input.notes ?? null,
      createdById: actorId,
    },
    include: { table: { select: { number: true, name: true, zone: true } } },
  });

  await audit({
    restaurantId,
    userId: actorId,
    action: "RESERVATION_CREATED",
    entityType: "Reservation",
    entityId: reservation.id,
    after: { tableId: input.tableId, time: input.reservationTime.toISOString(), partySize: input.partySize },
  });
  emitToWorkspace(EVENTS.RESERVATION_UPDATED, { id: reservation.id, tableId: reservation.tableId });
  return reservation;
}

export async function updateReservation(
  id: string,
  restaurantId: string,
  actorId: string,
  patch: Partial<ReservationInput>,
) {
  const existing = await prisma.reservation.findFirst({ where: { id, restaurantId } });
  if (!existing) throw ApiError.notFound("Reservation not found");
  if (existing.status !== "CONFIRMED") throw ApiError.conflict("Only confirmed reservations can be edited");

  const tableId = patch.tableId ?? existing.tableId;
  const startsAt = patch.reservationTime ?? existing.reservationTime;
  const duration = patch.durationMinutes ?? existing.durationMinutes;
  if (patch.tableId) await assertTable(restaurantId, tableId);
  await assertNoConflict(tableId, startsAt, duration, id);

  const reservation = await prisma.reservation.update({
    where: { id },
    data: {
      tableId,
      reservationTime: startsAt,
      durationMinutes: duration,
      ...(patch.customerName !== undefined ? { customerName: patch.customerName } : {}),
      ...(patch.customerPhone !== undefined ? { customerPhone: patch.customerPhone ?? null } : {}),
      ...(patch.partySize !== undefined ? { partySize: patch.partySize } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
    },
    include: { table: { select: { number: true, name: true, zone: true } } },
  });

  await audit({
    restaurantId,
    userId: actorId,
    action: "RESERVATION_UPDATED",
    entityType: "Reservation",
    entityId: id,
    before: { tableId: existing.tableId, time: existing.reservationTime.toISOString() },
    after: { tableId: reservation.tableId, time: reservation.reservationTime.toISOString() },
  });
  emitToWorkspace(EVENTS.RESERVATION_UPDATED, { id, tableId: reservation.tableId });
  return reservation;
}

export async function seatReservation(id: string, restaurantId: string, actorId: string) {
  const reservation = await prisma.reservation.findFirst({ where: { id, restaurantId } });
  if (!reservation) throw ApiError.notFound("Reservation not found");
  if (reservation.status !== "CONFIRMED") throw ApiError.conflict("Reservation is not awaiting seating");

  const open = await prisma.tableSession.findFirst({
    where: { tableId: reservation.tableId, status: "OPEN" },
    include: { order: { select: { orderNumber: true, status: true } } },
  });
  if (open?.order && open.order.status !== "COMPLETED" && open.order.status !== "CANCELLED") {
    throw ApiError.conflict(`Table already has an open order #${open.order.orderNumber}`);
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.reservation.update({ where: { id }, data: { status: "SEATED" } });
    if (open) {
      await tx.tableSession.update({ where: { id: open.id }, data: { seatedAt: now } });
    } else {
      await tx.tableSession.create({ data: { tableId: reservation.tableId, status: "OPEN", seatedAt: now } });
    }
    await tx.restaurantTable.update({
      where: { id: reservation.tableId },
      data: { status: "OCCUPIED", version: { increment: 1 } },
    });
    return r;
  });

  await audit({
    restaurantId,
    userId: actorId,
    action: "RESERVATION_SEATED",
    entityType: "Reservation",
    entityId: id,
    after: { tableId: reservation.tableId },
  });
  emitToWorkspace(EVENTS.TABLE_UPDATED, { tableId: reservation.tableId, status: "OCCUPIED" });
  emitToWorkspace(EVENTS.RESERVATION_UPDATED, { id, tableId: reservation.tableId, status: "SEATED" });
  return updated;
}

async function closeReservation(id: string, restaurantId: string, actorId: string, status: "NO_SHOW" | "CANCELLED") {
  const reservation = await prisma.reservation.findFirst({ where: { id, restaurantId } });
  if (!reservation) throw ApiError.notFound("Reservation not found");
  if (reservation.status !== "CONFIRMED") throw ApiError.conflict("Reservation is no longer active");

  const updated = await prisma.reservation.update({ where: { id }, data: { status } });
  await audit({
    restaurantId,
    userId: actorId,
    action: status === "NO_SHOW" ? "RESERVATION_NO_SHOW" : "RESERVATION_CANCELLED",
    entityType: "Reservation",
    entityId: id,
    before: { status: "CONFIRMED" },
    after: { status },
  });
  emitToWorkspace(EVENTS.RESERVATION_UPDATED, { id, tableId: reservation.tableId, status });
  return updated;
}

export const markReservationNoShow = (id: string, restaurantId: string, actorId: string) =>
  closeReservation(id, restaurantId, actorId, "NO_SHOW");
export const cancelReservation = (id: string, restaurantId: string, actorId: string) =>
  closeReservation(id, restaurantId, actorId, "CANCELLED");

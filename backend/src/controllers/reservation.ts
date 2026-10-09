import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../../generated/prisma/client";
import { activitiesLog } from "../lib/activities-log";
import { getIO } from "../lib/socket";
import {
  notifyReservationCreated,
  notifyReservationStatus,
  pushReservation,
} from "../lib/notify";

/**
 * Roles allowed to see and act on the whole booking book.
 *
 * The floor and the host desk manage every table, so they need the unfiltered
 * view plus the optional `?userId=` filter the host desk uses to look someone
 * up. Everyone else is a diner and may only ever reach their own reservations.
 */
const FLOOR_ROLES = new Set(["ADMIN", "MANAGER", "STAFF"]);

const callerOf = (req: Request) =>
  (req as any).user as { id: string; role?: string };

const managesAllReservations = (req: Request) =>
  FLOOR_ROLES.has(callerOf(req).role ?? "");

/**
 * Internal signal for "that table just got taken".
 *
 * Thrown from inside the booking transaction so the insert rolls back, then
 * caught and translated to a 409. Keeping it as a distinct class is what stops
 * a normal double-booking from being reported to the guest as a server error.
 */
class ReservationConflictError extends Error {
  constructor() {
    super("Table is already booked around this time.");
    this.name = "ReservationConflictError";
  }
}

export const createReservation = async (req: Request, res: Response) => {
  try {
    const { customerName, date, guests, tableId, email } = req.body;

    if (!date || !guests || !tableId) {
      return res
        .status(400)
        .json({ error: "Missing required fields: date, guests, tableId" });
    }

    // Prevent double booking on the exact same table within a 2-hour window
    //   let fix date format
    const requestedTime = new Date(date);
    const twoHoursBefore = new Date(
      requestedTime.getTime() - 2 * 60 * 60 * 1000,
    );
    const twoHoursAfter = new Date(
      requestedTime.getTime() + 2 * 60 * 60 * 1000,
    );

    // Check-and-insert inside one transaction.
    //
    // These were two separate awaits: read for a conflict, then insert. Two
    // waiters booking the same table at the same minute both saw "no conflict"
    // and both persisted, because nothing serialised them. A transaction makes
    // the read and the write a single unit, so the second writer either waits
    // and then sees the first one's row, or is rejected outright.
    const reservation = await prisma.$transaction(async (tx) => {
      const conflictingBooking = await tx.reservation.findFirst({
        where: {
          tableId,
          status: { in: ["PENDING", "CONFIRMED"] },
          date: { gte: twoHoursBefore, lte: twoHoursAfter },
        },
      });

      if (conflictingBooking) {
        // Thrown so the transaction rolls back. Translated to a 409 in the
        // catch below rather than leaking a Prisma error to the client.
        throw new ReservationConflictError();
      }

      return tx.reservation.create({
        data: {
          customerName: customerName || (req as any).user?.name || "Guest",
          email: email || (req as any).user?.email || null,
          date: requestedTime,
          guests: Number(guests),
          tableId,
          userId: (req as any).user?.id, // Associate reservation with the authenticated user
        },
        include: { table: true },
      });
    });
    getIO().emit("new-reservation", {
      name: reservation.customerName,
      time: reservation.date,
    });

    // PRO: confirmation email to the guest/customer + push alert to the host desk.
    // Both are fire-and-forget; a failure here must not fail the booking.
    await Promise.allSettled([
      notifyReservationCreated(reservation.id),
      pushReservation({
        id: reservation.id,
        customerName: reservation.customerName,
        guests: reservation.guests,
        date: reservation.date,
      }),
    ]);

    res.status(201).json(reservation);
  } catch (error) {
    // A lost race for the table is a normal outcome, not a fault. Reported as
    // 409 Conflict so the booking form can say "that slot just went" and offer
    // another time, instead of showing a generic failure.
    if (error instanceof ReservationConflictError) {
      return res.status(409).json({ error: error.message });
    }

    console.error("Error creating reservation:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getReservations = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    // Clamped at both ends: unbounded `?limit=` would `take` the whole booking
    // book in one response.
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string) || 10),
    );
    const skip = (page - 1) * limit;

    // A diner's `?userId=` is IGNORED, not obeyed.
    //
    // This filter used to be applied unconditionally from the query string, so
    // omitting the parameter fell through to `{}` and returned every booking in
    // the system — customerName, email, guests, date and table for the entire
    // restaurant — to anyone signed in. Pinning a diner to their own id means
    // the query can no longer be widened from the client at all.
    const requestedUserId =
      typeof req.query.userId === "string" && req.query.userId
        ? req.query.userId
        : undefined;

    const whereClause: Prisma.ReservationWhereInput = managesAllReservations(req)
      ? requestedUserId
        ? { userId: requestedUserId }
        : {}
      : { userId: callerOf(req).id };

    const [reservations, totalReservations] = await Promise.all([
      prisma.reservation.findMany({
        skip: skip,
        take: limit,
        where: whereClause,
        include: { table: true }, // Include table data so we can show table names
        orderBy: { date: "asc" },
      }),
      prisma.reservation.count({
        where: whereClause,
      }),
    ]);

    const totalPages = Math.ceil(totalReservations / limit);

    res.status(200).json({
      data: reservations,
      totalReservations,
      itemsPerPage: limit,
      currentPage: page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  } catch (error) {
    console.error("Error fetching reservations:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const RESERVATION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
] as const;

type ReservationStatusValue = (typeof RESERVATION_STATUSES)[number];

const isReservationStatus = (v: unknown): v is ReservationStatusValue =>
  typeof v === "string" &&
  (RESERVATION_STATUSES as readonly string[]).includes(v);

export const updateReservationStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Without this allowlist an unrecognised value reached the driver and came
    // back as a 500 carrying the raw Prisma enum error.
    if (!isReservationStatus(status)) {
      return res.status(400).json({
        error: `Invalid reservation status. Expected one of: ${RESERVATION_STATUSES.join(", ")}`,
      });
    }

    // Ownership: a diner may only move their OWN booking.
    //
    // CUSTOMER holds `reservation: ["create","read","update"]`, and the route's
    // role list includes CUSTOMER, so without this check any signed-in diner
    // could cancel or complete an arbitrary reservation just by naming its id —
    // which also flipped the victim's table to AVAILABLE/OCCUPIED and sent the
    // status email to the victim. `userId` is immutable in practice, so
    // checking it before the transaction is safe.
    const existing = await prisma.reservation.findUnique({
      where: { id: id as string },
      select: { userId: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Reservation not found" });
    }

    if (!managesAllReservations(req) && existing.userId !== callerOf(req).id) {
      return res.status(403).json({
        error: "Forbidden: you can only update your own reservation",
      });
    }

    // we use transaction to ensure all operations succeed or fail together
    const updated = await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.update({
        where: { id: id as string },
        data: { status },
      });

      if (status === "CANCELLED") {
        await tx.table.update({
          where: { id: reservation.tableId },
          data: { status: "AVAILABLE" },
        });
      }

      // If checking in (COMPLETED), automatically mark the table as OCCUPIED
      if (status === "COMPLETED" || status === "CONFIRMED") {
        await tx.table.update({
          where: { id: reservation.tableId },
          data: { status: "OCCUPIED" },
        });
      }
      return reservation;
    });
    getIO().emit("status-reservation", {
      status,
      name: updated.customerName,
      time: updated.date,
    });
    await activitiesLog({
      userId: (req as any).user?.id,
      action: "UPDATE_RESERVATION",
      details: `Reservation updated: ${updated.id}, New Status: ${status}`,
    });

    // PRO: notify the guest about the new status.
    // Deliberately AFTER the transaction commits — never send mail inside a tx.
    await notifyReservationStatus(updated.id, status);

    res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating reservation status:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

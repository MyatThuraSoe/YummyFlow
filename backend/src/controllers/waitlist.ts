import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { activitiesLog } from "../lib/activities-log";
import { getIO } from "../lib/socket";

/**
 * Walk-in queue.
 *
 * Reservations cover parties who booked ahead. This covers the ones standing at
 * the door with nowhere to sit, which is the gap that makes a host desk invent
 * its own spreadsheet.
 *
 * Positions are derived from `createdAt` rather than stored, so two people
 * cannot be given the same number and the ordering can never disagree with the
 * arrival times.
 */

const WAITLIST_STATUSES = [
  "WAITING",
  "SEATED",
  "NO_SHOW",
  "CANCELLED",
] as const;

type WaitlistStatusValue = (typeof WAITLIST_STATUSES)[number];

const isWaitlistStatus = (v: unknown): v is WaitlistStatusValue =>
  typeof v === "string" &&
  (WAITLIST_STATUSES as readonly string[]).includes(v);

/**
 * The queue as the host desk needs it, plus a wait estimate.
 *
 * The estimate is a mean over parties that were actually seated today: for each
 * one, how long from joining to being seated. A mean over an empty history is
 * undefined, so it is reported as `null` and the UI says so rather than
 * inventing "about 0 minutes".
 */
export const getWaitlist = async (_req: Request, res: Response) => {
  try {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const [waiting, seatedToday, all] = await Promise.all([
      prisma.waitlist.findMany({
        where: { status: "WAITING" },
        orderBy: { createdAt: "asc" },
        include: { table: { select: { id: true, name: true, seats: true } } },
      }),
      prisma.waitlist.findMany({
        where: { status: "SEATED", seatedAt: { gte: dayStart } },
        select: { createdAt: true, seatedAt: true },
      }),
      prisma.waitlist.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { table: { select: { id: true, name: true, seats: true } } },
      }),
    ]);

    const waits = seatedToday
      .map((w) =>
        w.seatedAt
          ? (w.seatedAt.getTime() - w.createdAt.getTime()) / 60000
          : null,
      )
      .filter((n): n is number => n !== null && n >= 0);

    const averageWait = waits.length
      ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
      : null;

    res.status(200).json({
      data: {
        waiting: waiting.map((w, index) => ({
          id: w.id,
          customerName: w.customerName,
          phone: w.phone,
          email: w.email,
          guests: w.guests,
          notes: w.notes,
          table: w.table,
          // 1-based: "you are third in line" is what the host says out loud.
          position: index + 1,
          waitingMinutes: Math.max(
            0,
            Math.round((Date.now() - w.createdAt.getTime()) / 60000),
          ),
          // Only meaningful for a queue long enough to need a number. A party
          // at the front of a three-deep list is not waiting an hour.
          estimatedWaitMinutes: averageWait === null ? null : averageWait * (index + 1),
          createdAt: w.createdAt,
        })),
        recent: all.map((w) => ({
          id: w.id,
          customerName: w.customerName,
          guests: w.guests,
          status: w.status,
          table: w.table,
          seatedAt: w.seatedAt,
          createdAt: w.createdAt,
        })),
        stats: {
          waiting: waiting.length,
          seatedToday: seatedToday.length,
          coversWaiting: waiting.reduce((sum, w) => sum + w.guests, 0),
          averageWaitMinutes: averageWait,
        },
      },
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching waitlist:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Public queue snapshot for the join page.
 *
 * Exposes the depth of the line and nothing else — no names, no phone numbers.
 * A walk-in who has not given their details yet must be able to see whether it
 * is worth queueing, without the queue being a directory of everyone else
 * waiting.
 */
export const getWaitlistPublic = async (_req: Request, res: Response) => {
  try {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const [waiting, seatedToday] = await Promise.all([
      prisma.waitlist.findMany({
        where: { status: "WAITING" },
        select: { guests: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.waitlist.findMany({
        where: { status: "SEATED", seatedAt: { gte: dayStart } },
        select: { createdAt: true, seatedAt: true },
      }),
    ]);

    const waits = seatedToday
      .map((w) =>
        w.seatedAt ? (w.seatedAt.getTime() - w.createdAt.getTime()) / 60000 : null,
      )
      .filter((n): n is number => n !== null && n >= 0);

    const averageWait = waits.length
      ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
      : null;

    res.status(200).json({
      data: {
        partiesAhead: waiting.length,
        coversAhead: waiting.reduce((sum, w) => sum + w.guests, 0),
        averageWaitMinutes: averageWait,
        // Longest current wait, so the page can warn a walk-in honestly rather
        // than quoting an average that hides one party stuck at the back.
        longestWaitMinutes: waiting.length
          ? Math.max(
              0,
              Math.round((Date.now() - waiting[0]!.createdAt.getTime()) / 60000),
            )
          : 0,
        accepting: true,
      },
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching public waitlist:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Join the queue.
 *
 * Public by design — a walk-in at the door has no account, and requiring one
 * would defeat the feature.
 *
 * Note what does NOT protect this route: name, party size and notes are all
 * caller-supplied and trivially forged, so they are validation, not a
 * defence. An earlier version of this comment claimed otherwise. The real
 * protections are a per-IP rate limit and a same-day duplicate check, neither
 * of which exists yet — see the audit notes. Until they do, treat this as an
 * open endpoint and do not let queue size feed any automated decision.
 */
export const joinWaitlist = async (req: Request, res: Response) => {
  try {
    const { customerName, phone, email, guests, notes } = req.body ?? {};

    if (!customerName || typeof customerName !== "string" || !customerName.trim()) {
      return res.status(400).json({ error: "A name is required" });
    }

    const partySize = Number(guests);
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 40) {
      return res
        .status(400)
        .json({ error: "Party size must be between 1 and 40" });
    }

    // Best-effort contact so the host can call the party when a table frees up.
    // A malformed address is dropped rather than rejected — the walk-in is
    // already standing there.
    const cleanedPhone = phone ? String(phone).trim().slice(0, 40) : null;
    const candidateEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanedEmail =
      candidateEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)
        ? candidateEmail.slice(0, 160)
        : null;

    const entry = await prisma.waitlist.create({
      data: {
        customerName: customerName.trim().slice(0, 120),
        phone: cleanedPhone,
        email: cleanedEmail,
        guests: partySize,
        notes: notes ? String(notes).trim().slice(0, 280) : null,
        // No `userId`: this route is deliberately unauthenticated, so
        // `req.user` is always undefined and the column does not exist. An
        // earlier version wrote it here, which is a field Prisma's generic
        // `create<T>` signature does not excess-property-check — so it passed
        // `tsc` and would have failed (or silently dropped) at runtime.
      },
    });

    // Tell the host desk without making the walk-in's browser subscribe to
    // anything — the socket is opened on their behalf, not the guest's.
    getIO().emit("waitlist-updated", { type: "joined" });

    const ahead = await prisma.waitlist.count({
      where: { status: "WAITING", createdAt: { lt: entry.createdAt } },
    });

    res.status(201).json({
      data: {
        id: entry.id,
        customerName: entry.customerName,
        guests: entry.guests,
        position: ahead + 1,
        createdAt: entry.createdAt,
      },
      message: "You are on the list",
    });
  } catch (error) {
    console.error("Error joining waitlist:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Seat, no-show, or cancel a waiting party.
 *
 * Seating optionally claims a table in the same transaction, because a queue
 * entry marked SEATED with no table is the exact state that leaves a host
 * desk unable to answer "where did that party go".
 */
export const updateWaitlistStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { status, tableId, notes } = req.body ?? {};

    if (!isWaitlistStatus(status)) {
      return res.status(400).json({
        error: `Status must be one of ${WAITLIST_STATUSES.join(", ")}`,
      });
    }

    const entry = await prisma.waitlist.findUnique({ where: { id } });
    if (!entry) {
      return res.status(404).json({ message: "Waitlist entry not found" });
    }

    if (entry.status !== "WAITING" && entry.status !== status) {
      return res.status(409).json({
        error: `This party is already ${entry.status.toLowerCase()}`,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // The table-availability check has to be INSIDE the transaction.
      //
      // Two hosts seating two parties at the same table is not a theoretical
      // race: it is two people clicking at the same moment on a Friday. Read
      // the table before opening the transaction and both requests see
      // AVAILABLE, both set OCCUPIED, and the table ends up double-booked with
      // two parties told they have it.
      if (status === "SEATED" && tableId) {
        const table = await tx.table.findUnique({
          where: { id: tableId },
          select: { id: true, name: true, status: true },
        });
        if (!table) {
          const err = new Error("Table not found") as Error & { code?: string };
          err.code = "TABLE_MISSING";
          throw err;
        }
        if (table.status === "OCCUPIED") {
          const err = new Error(table.name) as Error & {
            code?: string;
          };
          err.code = "TABLE_OCCUPIED";
          throw err;
        }
      }

      const next = await tx.waitlist.update({
        where: { id },
        data: {
          status,
          // Only stamped on the transition into SEATED, so re-saving a seated
          // entry does not rewrite the wait time it is being measured against.
          seatedAt: status === "SEATED" ? (entry.seatedAt ?? new Date()) : entry.seatedAt,
          ...(tableId !== undefined ? { tableId: tableId || null } : {}),
          ...(notes !== undefined
            ? { notes: notes ? String(notes).slice(0, 280) : null }
            : {}),
        },
        include: { table: { select: { id: true, name: true, seats: true } } },
      });

      if (status === "SEATED" && tableId) {
        await tx.table.update({
          where: { id: tableId },
          data: { status: "OCCUPIED" },
        });
      }

      return next;
    });

    await activitiesLog({
      userId: (req as any).user?.id,
      action:
        status === "SEATED"
          ? "SEAT_WAITLIST"
          : status === "NO_SHOW"
            ? "WAITLIST_NO_SHOW"
            : "CANCEL_WAITLIST",
      details: `${entry.customerName} (${entry.guests}) marked ${status}${
        updated.table ? ` at ${updated.table.name}` : ""
      }`,
    });

    getIO().emit("waitlist-updated", { type: status });

    // Seating claims a table, so the floor plan on every other screen is now
    // stale. Without this the acting host's own client happens to refetch
    // (its mutation invalidates the table keys) but nobody else's does, and the
    // next party is seated at a table the floor plan still shows as free.
    if (status === "SEATED" && tableId) {
      getIO().emit("table-updated");
    }

    res.status(200).json({ data: updated });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "TABLE_MISSING") {
      return res.status(404).json({ message: "Table not found" });
    }
    if (code === "TABLE_OCCUPIED") {
      return res
        .status(409)
        .json({ error: `Table ${(error as Error).message} is already occupied` });
    }
    console.error("Error updating waitlist:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const removeWaitlistEntry = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const entry = await prisma.waitlist.findUnique({
      where: { id },
      select: {
        id: true,
        customerName: true,
        status: true,
        tableId: true,
        table: { select: { name: true } },
      },
    });

    if (!entry) {
      return res.status(404).json({ message: "Waitlist entry not found" });
    }

    // Deleting a SEATED entry used to leave its table OCCUPIED with nothing
    // pointing at it — the table was held forever and the floor plan showed it
    // busy with no party to explain why. Release it in the same transaction as
    // the delete so the two can never disagree.
    const releasedTable =
      entry.status === "SEATED" && entry.tableId
        ? { id: entry.tableId, name: entry.table?.name }
        : null;

    await prisma.$transaction(async (tx) => {
      await tx.waitlist.delete({ where: { id } });
      if (releasedTable) {
        await tx.table.update({
          where: { id: releasedTable.id },
          data: { status: "AVAILABLE" },
        });
      }
    });

    await activitiesLog({
      userId: (req as any).user?.id,
      action: "DELETE_WAITLIST",
      details: `${entry.customerName} removed from the waitlist${
        releasedTable ? `; table ${releasedTable.name} released` : ""
      }`,
    });

    getIO().emit("waitlist-updated", { type: "removed" });
    if (releasedTable) {
      getIO().emit("table-updated");
    }

    res.status(200).json({ message: "Waitlist entry removed" });
  } catch (error) {
    console.error("Error removing waitlist entry:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

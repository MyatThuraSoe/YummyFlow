import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { bsonDate, parseUtcDayWindow, utcDayKey } from "../lib/bson";

/**
 * Service-day close — the "Z report" a manager runs when the doors shut.
 *
 * A shift cannot be signed off from a rolling 7-day dashboard: you need one
 * day, cut cleanly, with the money reconciled. Everything here aggregates
 * inside MongoDB for the same reason the dashboard does — a few hundred covers
 * is a few hundred orders, and pulling them into Node to `reduce()` them is
 * work the database already does better and cheaper.
 *
 * The response also carries `blockers`: the concrete reasons the day is not
 * actually closed yet. "3 tables still occupied" is actionable; a green tick on
 * a report nobody can trust is not.
 */

const round2 = (n: number) => Number(n.toFixed(2));

type Row = Record<string, any>;

/** Rows out of a `$runCommandRaw` aggregation, or an empty list. */
const firstBatch = (res: unknown): Row[] =>
  ((res as any)?.cursor?.firstBatch ?? []) as Row[];

/** The window used for "today's orders" everywhere in this report. */
const OPEN_STATUSES = ["PENDING", "PREPARING", "READY"] as const;

export const getDayClose = async (req: Request, res: Response) => {
  try {
    const window = parseUtcDayWindow(req.query.date);
    if (!window) {
      return res.status(400).json({
        error: "Invalid date — expected a real calendar day as YYYY-MM-DD",
      });
    }

    const { start, end } = window;
    const createdAt = { gte: start, lt: end };
    const notCancelled = { status: { not: "CANCELLED" as const } };
    const scoped = { createdAt, ...notCancelled };

    const [
      byType,
      byStatus,
      byPayment,
      paid,
      unpaid,
      cancelled,
      voids,
      tablesByStatus,
      tableTotals,
      reservationsByStatus,
      hourlyRes,
      itemsRes,
    ] = await Promise.all([
      // Money and covers split by how the order left the building.
      prisma.order.groupBy({
        by: ["orderType"],
        where: scoped,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),

      // Where the kitchen got to. Mostly SERVED by close, but any order still
      // PENDING/PREPARING/READY is a blocker.
      prisma.order.groupBy({
        by: ["status"],
        where: { createdAt },
        _count: { _all: true },
      }),

      // The till reconciliation — what is physically in the drawer vs the bank.
      prisma.order.groupBy({
        by: ["paymentMethod"],
        where: { ...scoped, paymentStatus: "PAID" },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),

      prisma.order.aggregate({
        where: { ...scoped, paymentStatus: "PAID" },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),

      prisma.order.aggregate({
        where: { ...scoped, paymentStatus: { not: "PAID" } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),

      prisma.order.aggregate({
        where: { createdAt, status: "CANCELLED" },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),

      // A void total nobody can explain is worse than no total, so list them.
      prisma.order.findMany({
        where: { createdAt, status: "CANCELLED" },
        select: {
          id: true,
          orderType: true,
          totalAmount: true,
          createdAt: true,
          table: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),

      prisma.table.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.table.aggregate({
        _count: { _all: true },
        _sum: { seats: true },
      }),

      prisma.reservation.groupBy({
        by: ["status"],
        where: { date: { gte: start, lt: end } },
        _count: { _all: true },
        _sum: { guests: true },
      }),

      // Trading pattern across the service — shows the manager whether the
      // staffing matched the rush.
      prisma.$runCommandRaw({
        aggregate: "Order",
        pipeline: [
          {
            $match: {
              createdAt: { $gte: bsonDate(start), $lt: bsonDate(end) },
              status: { $ne: "CANCELLED" },
            },
          },
          {
            $group: {
              _id: { $hour: "$createdAt" },
              orders: { $sum: 1 },
              revenue: {
                $sum: {
                  $cond: [
                    { $eq: ["$paymentStatus", "PAID"] },
                    "$totalAmount",
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
        cursor: {},
      }),

      // What actually sold, ranked by revenue rather than by count — the
      // kitchen wants to know where the money came from, not just volume.
      prisma.$runCommandRaw({
        aggregate: "OrderItem",
        pipeline: [
          {
            $lookup: {
              from: "Order",
              localField: "orderId",
              foreignField: "_id",
              as: "order",
            },
          },
          { $unwind: "$order" },
          {
            $match: {
              "order.createdAt": {
                $gte: bsonDate(start),
                $lt: bsonDate(end),
              },
              "order.status": { $ne: "CANCELLED" },
            },
          },
          {
            $group: {
              _id: "$menuItemId",
              quantity: { $sum: "$quantity" },
              revenue: { $sum: { $multiply: ["$price", "$quantity"] } },
            },
          },
          { $sort: { revenue: -1 } },
          { $limit: 10 },
          {
            $lookup: {
              from: "menuItem",
              localField: "_id",
              foreignField: "_id",
              as: "menuItem",
            },
          },
          { $unwind: { path: "$menuItem", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              // The dish may have been deleted since it was sold.
              name: { $ifNull: ["$menuItem.name", "Deleted item"] },
              quantity: 1,
              revenue: 1,
            },
          },
        ],
        cursor: {},
      }),
    ]);

    // -- Revenue ------------------------------------------------------------
    const gross = round2(
      byType.reduce((sum, g) => sum + (g._sum.totalAmount ?? 0), 0),
    );
    const collected = round2(paid._sum.totalAmount ?? 0);
    const outstanding = round2(unpaid._sum.totalAmount ?? 0);
    const voided = round2(cancelled._sum.totalAmount ?? 0);

    // -- Orders -------------------------------------------------------------
    const statusCount = (s: string) =>
      byStatus.find((g) => g.status === s)?._count._all ?? 0;

    const totalOrders = byStatus.reduce((sum, g) => sum + g._count._all, 0);
    const openOrders = OPEN_STATUSES.reduce(
      (sum, s) => sum + statusCount(s),
      0,
    );
    const paidOrders = paid._count._all;

    // -- Tables -------------------------------------------------------------
    const tablesTotal = tableTotals._count._all;
    const tableSeats = tableTotals._sum.seats ?? 0;
    const tableStatus = (s: string) =>
      tablesByStatus.find((g) => g.status === s)?._count._all ?? 0;
    const occupied = tableStatus("OCCUPIED");
    const cleaning = tableStatus("CLEANING");

    // -- Reservations -------------------------------------------------------
    const reservationStatus = (s: string) =>
      reservationsByStatus.find((g) => g.status === s)?._count._all ?? 0;

    // -- Blockers -----------------------------------------------------------
    // The point of the report: what still has to happen before the shift ends.
    const blockers: string[] = [];
    if (openOrders > 0) {
      blockers.push(
        `${openOrders} order${openOrders === 1 ? "" : "s"} still open in the kitchen`,
      );
    }
    if (unpaid._count._all > 0) {
      blockers.push(
        `${unpaid._count._all} unpaid order${
          unpaid._count._all === 1 ? "" : "s"
        } totalling $${outstanding.toFixed(2)}`,
      );
    }
    if (occupied > 0) {
      blockers.push(
        `${occupied} table${occupied === 1 ? "" : "s"} still occupied`,
      );
    }
    if (cleaning > 0) {
      blockers.push(
        `${cleaning} table${cleaning === 1 ? "" : "s"} waiting to be cleaned`,
      );
    }

    return res.status(200).json({
      data: {
        businessDate: utcDayKey(start),
        window: { start: start.toISOString(), end: end.toISOString() },

        revenue: { gross, collected, outstanding, voided },

        orders: {
          total: totalOrders,
          paid: paidOrders,
          open: openOrders,
          cancelled: cancelled._count._all,
          averageTicket: paidOrders > 0 ? round2(collected / paidOrders) : 0,
          byType: byType.map((g) => ({
            type: g.orderType,
            count: g._count._all,
            revenue: round2(g._sum.totalAmount ?? 0),
          })),
          byStatus: byStatus.map((g) => ({
            status: g.status,
            count: g._count._all,
          })),
        },

        payments: byPayment.map((g) => ({
          method: g.paymentMethod,
          count: g._count._all,
          amount: round2(g._sum.totalAmount ?? 0),
        })),

        hourly: firstBatch(hourlyRes).map((r) => ({
          hour: r._id as number,
          orders: r.orders as number,
          revenue: round2(r.revenue ?? 0),
        })),

        items: firstBatch(itemsRes).map((r) => ({
          name: r.name as string,
          quantity: r.quantity as number,
          revenue: round2(r.revenue ?? 0),
        })),

        voids: voids.map((o) => ({
          id: o.id,
          orderType: o.orderType,
          totalAmount: round2(o.totalAmount),
          createdAt: o.createdAt,
          tableName: o.table?.name ?? null,
        })),

        tables: {
          total: tablesTotal,
          seats: tableSeats,
          available: tableStatus("AVAILABLE"),
          occupied,
          reserved: tableStatus("RESERVED"),
          cleaning,
          occupancyPct:
            tablesTotal > 0 ? Math.round((occupied / tablesTotal) * 100) : 0,
        },

        reservations: {
          total: reservationsByStatus.reduce(
            (sum, g) => sum + g._count._all,
            0,
          ),
          guests: reservationsByStatus.reduce(
            (sum, g) => sum + (g._sum.guests ?? 0),
            0,
          ),
          pending: reservationStatus("PENDING"),
          confirmed: reservationStatus("CONFIRMED"),
          cancelled: reservationStatus("CANCELLED"),
          completed: reservationStatus("COMPLETED"),
        },

        /** Empty array means the day is genuinely clear to close. */
        blockers,
        closed: blockers.length === 0,
      },
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Day Close Error:", error);
    return res.status(500).json({ error: "Failed to build the day-close report" });
  }
};

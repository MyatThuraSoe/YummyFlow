import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../../generated/prisma/client";
import {
  addUtcDays,
  bsonDate,
  utcStartOfDaysAgo,
} from "../lib/bson";

/**
 * Dashboard rollups.
 *
 * These endpoints used to pull full order documents into Node and aggregate
 * them in JavaScript — `getDashboardCharts` alone loaded every paid order from
 * the last week with `items → menuItem → category` hydrated, on a 60-second
 * poll. At a few hundred covers a day that is thousands of documents per
 * refresh for two charts. Everything below aggregates inside MongoDB instead,
 * so only the handful of result rows cross the wire.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Percentage change between two windows; 100% when growing from zero. */
const trendPct = (current: number, previous: number) =>
  previous === 0
    ? current > 0
      ? 100
      : 0
    : Math.round(((current - previous) / previous) * 100);

const round2 = (n: number) => Number(n.toFixed(2));

const daysAgo = (from: Date, days: number) => addUtcDays(from, -days);

const CATEGORY_COLORS = [
  "#10b981", // emerald
  "#ef4444", // red
  "#eab308", // yellow
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#f97316", // orange
];

const WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

type WindowSummary = {
  revenue: number;
  orders: number;
  dineIn: number;
  takeAway: number;
};

/**
 * Four numbers per window via two indexed aggregate queries.
 *
 * The previous implementation ran two `findMany` calls that materialised every
 * order in a 14-day span purely to call `.length` and `.reduce` on them.
 */
async function summariseWindow(from: Date, to: Date): Promise<WindowSummary> {
  const where: Prisma.OrderWhereInput = {
    createdAt: { gte: from, lt: to },
    status: { not: "CANCELLED" },
  };

  const [byType, paid] = await Promise.all([
    prisma.order.groupBy({
      by: ["orderType"],
      where,
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: { ...where, paymentStatus: "PAID" },
      _sum: { totalAmount: true },
    }),
  ]);

  const countOf = (type: "DINE_IN" | "TAKEAWAY" | "DELIVERY") =>
    byType.find((g) => g.orderType === type)?._count._all ?? 0;

  return {
    revenue: round2(paid._sum.totalAmount ?? 0),
    orders: byType.reduce((sum, g) => sum + g._count._all, 0),
    dineIn: countOf("DINE_IN"),
    takeAway: countOf("TAKEAWAY") + countOf("DELIVERY"),
  };
}

export const getDashboardStats = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const currentStart = daysAgo(now, WINDOW_DAYS);
    const previousStart = daysAgo(now, WINDOW_DAYS * 2);

    const [current, previous] = await Promise.all([
      summariseWindow(currentStart, now),
      summariseWindow(previousStart, currentStart),
    ]);

    res.status(200).json({
      revenue: {
        value: current.revenue,
        trend: trendPct(current.revenue, previous.revenue),
      },
      orders: {
        value: current.orders,
        trend: trendPct(current.orders, previous.orders),
      },
      dineIn: {
        value: current.dineIn,
        trend: trendPct(current.dineIn, previous.dineIn),
      },
      takeAway: {
        value: current.takeAway,
        trend: trendPct(current.takeAway, previous.takeAway),
      },
    });
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
};

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

type DailySalesRow = { _id: string; sales: number; orders: number };
type CategoryRow = { _id: string; revenue: number };

export const getDashboardCharts = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    // Six days back so today is the seventh bucket.
    const since = utcStartOfDaysAgo(now, WINDOW_DAYS - 1);

    const [dailyRes, categoryRes] = await Promise.all([
      // Daily paid sales — grouped in the database, one row per day.
      prisma.$runCommandRaw({
        aggregate: "Order",
        pipeline: [
          {
            $match: {
              createdAt: { $gte: bsonDate(since) },
              status: { $ne: "CANCELLED" },
              paymentStatus: "PAID",
            },
          },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              sales: { $sum: "$totalAmount" },
              orders: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        cursor: {},
      }),

      // Revenue per menu category — joined and summed server-side. Previously
      // this walked every hydrated order item in Node.
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
              "order.createdAt": { $gte: bsonDate(since) },
              "order.status": { $ne: "CANCELLED" },
              "order.paymentStatus": "PAID",
            },
          },
          {
            $lookup: {
              from: "menuItem",
              localField: "menuItemId",
              foreignField: "_id",
              as: "menuItem",
            },
          },
          { $unwind: "$menuItem" },
          {
            $lookup: {
              from: "Category",
              localField: "menuItem.categoryId",
              foreignField: "_id",
              as: "category",
            },
          },
          { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: { $ifNull: ["$category.name", "Uncategorized"] },
              revenue: { $sum: { $multiply: ["$price", "$quantity"] } },
            },
          },
          { $sort: { revenue: -1 } },
        ],
        cursor: {},
      }),
    ]);

    const dailyRows = ((dailyRes as any).cursor?.firstBatch ??
      []) as DailySalesRow[];
    const categoryRows = ((categoryRes as any).cursor?.firstBatch ??
      []) as CategoryRow[];

    // Seed every day in the window so quiet days still render as zero rather
    // than vanishing from the axis. Grouping is UTC, so the labels are too.
    const byDay = new Map(dailyRows.map((r) => [r._id, r.sales]));
    const salesData: { time: string; sales: number }[] = [];

    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      const d = utcStartOfDaysAgo(now, i);
      const key = d.toISOString().slice(0, 10);
      salesData.push({
        time: d.toLocaleDateString("en-US", {
          weekday: "short",
          timeZone: "UTC",
        }),
        sales: round2(byDay.get(key) ?? 0),
      });
    }

    const totalIncome = round2(
      dailyRows.reduce((sum, r) => sum + (r.sales ?? 0), 0),
    );

    const categoryData = categoryRows
      .filter((row) => row.revenue > 0)
      .map((row, idx) => ({
        name: row._id,
        value: round2(row.revenue),
        color: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
      }));

    // Keep the chart from collapsing when there is nothing to show.
    if (categoryData.length === 0) {
      categoryData.push({ name: "No Sales Yet", value: 1, color: "#e2e8f0" });
    }

    res.status(200).json({ salesData, categoryData, totalIncome });
  } catch (error) {
    console.error("Dashboard Charts Error:", error);
    res.status(500).json({ error: "Failed to fetch chart data" });
  }
};

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

type TrendingRow = {
  id: string;
  name: string;
  image: string | null;
  orders: number;
};

const TRENDING_LIMIT = 4;

export const getDashboardLists = async (_req: Request, res: Response) => {
  try {
    const since = daysAgo(new Date(), WINDOW_DAYS);

    const [trendingRes, outOfStock] = await Promise.all([
      // Top sellers — counted and ranked by the database, then joined to the
      // menu item for the label and thumbnail. Only four rows come back.
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
              "order.createdAt": { $gte: bsonDate(since) },
              "order.status": { $ne: "CANCELLED" },
            },
          },
          { $group: { _id: "$menuItemId", orders: { $sum: "$quantity" } } },
          { $sort: { orders: -1 } },
          { $limit: TRENDING_LIMIT },
          {
            $lookup: {
              from: "menuItem",
              localField: "_id",
              foreignField: "_id",
              as: "menuItem",
            },
          },
          { $unwind: "$menuItem" },
          {
            $project: {
              _id: 0,
              id: { $toString: "$_id" },
              name: "$menuItem.name",
              image: "$menuItem.image",
              orders: 1,
            },
          },
        ],
        cursor: {},
      }),

      prisma.menuItem.findMany({
        where: { isAvailable: false },
        select: { id: true, name: true, image: true },
        take: TRENDING_LIMIT,
      }),
    ]);

    const trendingDishes = ((trendingRes as any).cursor?.firstBatch ??
      []) as TrendingRow[];

    res.status(200).json({ trendingDishes, outOfStock });
  } catch (error) {
    console.error("Dashboard Lists Error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard lists" });
  }
};

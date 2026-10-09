import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { bsonDate, utcStartOfDaysAgo } from "../lib/bson";

/**
 * Sales analytics: a weekday-by-hour heatmap and a ranked top-items list.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE ENDPOINT
 * ---------------------------------------------------------------------------
 * `/dashboard/charts` already returns a 7-day sales line and a category
 * donut. Folding two more datasets in there would mean every poll of a
 * two-chart panel dragged a 168-cell grid and a full item ranking with it.
 * These change on a different cadence to a live board, so they get their own
 * route and their own cache lifetime.
 *
 * Both aggregate inside MongoDB. The heatmap alone covers twelve weeks of
 * trading; pulling those orders into Node to `reduce()` them would move
 * thousands of documents across the wire to produce 168 numbers.
 */

const round2 = (n: number) => Number(n.toFixed(2));

/** Trading pattern is a habit, so it needs enough weeks to be one. */
const HEATMAP_WEEKS = 12;
const TOP_ITEM_LIMIT = 8;

/** `$dayOfWeek` is 1=Sunday..7=Saturday. Ordered the way a manager reads a week. */
const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export const getSalesAnalytics = async (_req: Request, res: Response) => {
  try {
    const since = utcStartOfDaysAgo(new Date(), HEATMAP_WEEKS * 7);

    const [heatmapRes, topItemsRes] = await Promise.all([
      // One row per (weekday, hour) pair. Grouping by the pair rather than by
      // day first keeps the whole grid to a single pass over the orders.
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
              _id: {
                day: { $dayOfWeek: "$createdAt" },
                hour: { $hour: "$createdAt" },
              },
              orders: { $sum: 1 },
              revenue: { $sum: "$totalAmount" },
            },
          },
          { $sort: { "_id.day": 1, "_id.hour": 1 } },
        ],
        cursor: {},
      }),

      // Ranked by revenue rather than by volume: the kitchen wants to know
      // where the money came from, and a cheap high-volume dish is a different
      // answer than a pricey low-volume one.
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
            $group: {
              _id: "$menuItemId",
              quantity: { $sum: "$quantity" },
              revenue: { $sum: { $multiply: ["$price", "$quantity"] } },
            },
          },
          { $sort: { revenue: -1 } },
          { $limit: TOP_ITEM_LIMIT },
          {
            $lookup: {
              from: "menuItem",
              localField: "_id",
              foreignField: "_id",
              as: "menuItem",
            },
          },
          {
            $unwind: { path: "$menuItem", preserveNullAndEmptyArrays: true },
          },
          // `menuItem` holds only a `categoryId`, so the name needs its own
          // join. Lost with the dish when it is deleted, hence the $ifNull.
          {
            $lookup: {
              from: "Category",
              localField: "menuItem.categoryId",
              foreignField: "_id",
              as: "category",
            },
          },
          {
            $unwind: { path: "$category", preserveNullAndEmptyArrays: true },
          },
          {
            $project: {
              _id: 0,
              id: { $toString: "$_id" },
              // The dish may have been deleted since it was sold, and the
              // money it earned is still in the books.
              name: { $ifNull: ["$menuItem.name", "Deleted item"] },
              image: { $ifNull: ["$menuItem.image", null] },
              isAvailable: { $ifNull: ["$menuItem.isAvailable", false] },
              category: { $ifNull: ["$category.name", "Uncategorised"] },
              quantity: 1,
              revenue: 1,
            },
          },
        ],
        cursor: {},
      }),
    ]);

    const heatRows = ((heatmapRes as any).cursor?.firstBatch ?? []) as {
      _id: { day: number; hour: number };
      orders: number;
      revenue: number;
    }[];

    // Seed all 168 cells so a quiet Sunday-night renders as a real zero rather
    // than a gap the reader has to interpret as "no data".
    const cell = new Map<string, { orders: number; revenue: number }>();
    for (const row of heatRows) {
      cell.set(`${row._id.day}-${row._id.hour}`, {
        orders: row.orders ?? 0,
        revenue: row.revenue ?? 0,
      });
    }

    const days: { day: string; hours: number[]; revenue: number[]; orders: number[] }[] =
      [];

    for (let day = 1; day <= 7; day++) {
      const hours: number[] = [];
      const revenue: number[] = [];
      const orders: number[] = [];

      for (let hour = 0; hour < 24; hour++) {
        const hit = cell.get(`${day}-${hour}`);
        hours.push(hour);
        revenue.push(round2(hit?.revenue ?? 0));
        orders.push(hit?.orders ?? 0);
      }

      days.push({
        day: WEEKDAY_LABELS[day - 1] ?? "—",
        hours,
        revenue,
        orders,
      });
    }

    const maxRevenue = Math.max(
      0,
      ...days.flatMap((d) => d.revenue),
    );

    const topItems = ((topItemsRes as any).cursor?.firstBatch ?? []) as {
      id: string;
      name: string;
      image: string | null;
      isAvailable: boolean;
      category: string;
      quantity: number;
      revenue: number;
    }[];

    const peak = days
      .flatMap((d) => d.revenue.map((revenue, hour) => ({ day: d.day, hour, revenue })))
      .reduce(
        (best, current) => (current.revenue > best.revenue ? current : best),
        { day: "—", hour: 0, revenue: 0 },
      );

    res.status(200).json({
      data: {
        heatmap: {
          days,
          maxRevenue: round2(maxRevenue),
          peak: { day: peak.day, hour: peak.hour, revenue: round2(peak.revenue) },
          weeks: HEATMAP_WEEKS,
          since: since.toISOString(),
        },
        topItems: topItems.map((i) => ({
          ...i,
          revenue: round2(i.revenue ?? 0),
          quantity: i.quantity ?? 0,
        })),
        totals: {
          trackedRevenue: round2(
            topItems.reduce((sum, i) => sum + (i.revenue ?? 0), 0),
          ),
        },
      },
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error building sales analytics:", error);
    res.status(500).json({ error: "Failed to build sales analytics" });
  }
};

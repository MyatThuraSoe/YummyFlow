import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";

/** Hard ceiling on a single page, so `?limit=` cannot ask for the whole table. */
const MAX_PAGE_SIZE = 100;

export const getActivitiesLog = async (req: Request, res: Response) => {
  try {
    // 1. Parse query parameters with defaults (page 1, limit 10)
    // `limit` is clamped at the top as well as the bottom: without an upper
    // bound `?limit=1000000` asks Prisma to `take` the entire audit table in a
    // single response, which is a free bulk dump of every row for whoever asks.
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(req.query.limit as string) || 10),
    );

    // 2. Calculate how many records to skip
    const skip = (page - 1) * limit;

    // 3. Run the data fetch and total count concurrently for better performance
    const [activities, totalItems] = await Promise.all([
      prisma.activitiesLog.findMany({
        skip: skip,
        take: limit,
        orderBy: {
          createdAt: "desc", // Optional: order by creation date
        },
      }),
      prisma.activitiesLog.count(), // Gets the total number of activities in the DB
    ]);

    // 4. Calculate pagination metadata
    const totalPages = Math.ceil(totalItems / limit);

    // 5. Return structured response
    res.status(200).json({
      data: activities,
      totalItems,
      itemsPerPage: limit,
      currentPage: page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    });
  } catch (error) {
    console.error("Error fetching activities log:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching the activities log." });
  }
};

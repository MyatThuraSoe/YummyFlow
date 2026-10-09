import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { activitiesLog } from "../lib/activities-log";
import { getIO } from "../lib/socket";

/**
 * Dish reviews.
 *
 * The model and the write path already existed but nothing could read a review
 * back or remove one, so a customer could rate a dish and never change their
 * mind. This adds the read and delete sides, and closes two holes in the write.
 */

const round1 = (n: number) => Number(n.toFixed(1));

const averageOf = (ratings: number[]) =>
  ratings.length ? round1(ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0;

export const submitFeedback = async (req: Request, res: Response) => {
  try {
    const { menuItemId } = req.params as { menuItemId: string };
    const { rating, comment } = req.body as {
      rating: number;
      comment?: string;
    };

    // The old check was `rating < 1 || rating > 5`, which floats happily
    // through it — 4.5 stars, or NaN from an empty field, both land in the
    // database and then poison every average the menu page shows.
    const score = Number(rating);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return res
        .status(400)
        .json({ error: "Rating must be a whole number between 1 and 5" });
    }

    // Without this the FK violation surfaced as a 500, and since MongoDB has no
    // referential integrity the write could even land for a dish that is gone.
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, name: true },
    });
    if (!menuItem) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    const actorId = (req as any).user?.id as string | undefined;

    // One review per person per dish. A second submission edits the first,
    // because silently discarding it produces the "I definitely rated that"
    // feeling, and averaging duplicates would let anyone skew a score.
    const existing = actorId
      ? await prisma.feedback.findFirst({
          where: { menuItemId, userId: actorId },
        })
      : null;

    const trimmed = comment ? String(comment).trim().slice(0, 1000) : null;

    const feedback = existing
      ? await prisma.feedback.update({
          where: { id: existing.id },
          data: { rating: score, comment: trimmed },
        })
      : await prisma.feedback.create({
          data: {
            rating: score,
            comment: trimmed,
            menuItemId,
            userId: actorId ?? null,
          },
        });

    // The menu list carries a precomputed average, so without this every
    // already-open menu screen keeps showing the old score until a refresh.
    getIO().emit("menu-updated");

    await activitiesLog({
      userId: (req as any).user?.id,
      action: existing ? "UPDATE_FEEDBACK" : "CREATE_FEEDBACK",
      details: `${menuItem.name} rated ${score} star${score === 1 ? "" : "s"}`,
    });

    res.status(existing ? 200 : 201).json({
      message: "Thank you for your feedback!",
      feedback,
    });
  } catch (error) {
    console.error("Error submitting feedback:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * The reviews for one dish, newest first, with the running average.
 *
 * Public, because a menu page has to show a rating to a customer who has not
 * signed in yet. Author details are deliberately limited to name and image —
 * a review feed is not an email list.
 */
export const getItemFeedback = async (req: Request, res: Response) => {
  try {
    const { menuItemId } = req.params as { menuItemId: string };
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
    const skip = (page - 1) * limit;

    const menuItem = await prisma.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, name: true },
    });
    if (!menuItem) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    const [rows, total, all] = await Promise.all([
      prisma.feedback.findMany({
        where: { menuItemId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { user: { select: { id: true, name: true, image: true } } },
      }),
      prisma.feedback.count({ where: { menuItemId } }),
      // Every rating, not just this page's — an average taken over the first
      // ten newest reviews is not the dish's score and drifts as they age out.
      prisma.feedback.findMany({
        where: { menuItemId },
        select: { rating: true },
      }),
    ]);

    const ratings = all.map((f) => f.rating);
    const totalPages = Math.ceil(total / limit);
    const averageRating = averageOf(ratings);

    // The star histogram is what makes a 3.6 average legible — without the
    // distribution, "3.6" gives a reader no way to judge the spread.
    const breakdown = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: ratings.filter((r) => r === star).length,
    }));

    res.status(200).json({
      data: rows.map((f) => ({
        id: f.id,
        rating: f.rating,
        comment: f.comment,
        author: f.user?.name ?? "Guest",
        authorImage: f.user?.image ?? null,
        createdAt: f.createdAt,
      })),
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      averageRating,
      totalReviews: total,
      breakdown,
      totalItems: total,
      itemsPerPage: limit,
      currentPage: page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching feedback:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Remove a review.
 *
 * The author may always delete their own. ADMIN and MANAGER may delete any,
 * which is the moderation escape hatch a public rating form needs.
 */
export const deleteFeedback = async (req: Request, res: Response) => {
  try {
    const { feedbackId } = req.params as { feedbackId: string };

    const feedback = await prisma.feedback.findUnique({
      where: { id: feedbackId },
      include: {
        menuItem: { select: { id: true, name: true } },
      },
    });

    if (!feedback) {
      return res.status(404).json({ message: "Review not found" });
    }

    const user = (req as any).user as { id: string; role?: string } | undefined;
    const isAuthor = feedback.userId && user && feedback.userId === user.id;
    const isModerator = user?.role === "ADMIN" || user?.role === "MANAGER";

    if (!isAuthor && !isModerator) {
      return res
        .status(403)
        .json({ message: "You can only remove your own review" });
    }

    await prisma.feedback.delete({ where: { id: feedbackId } });

    getIO().emit("menu-updated");

    await activitiesLog({
      userId: user?.id,
      action: "DELETE_FEEDBACK",
      details: `${isModerator && !isAuthor ? "Moderated" : "Removed"} review on ${feedback.menuItem.name}`,
    });

    res.status(200).json({ message: "Review removed" });
  } catch (error) {
    console.error("Error deleting feedback:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

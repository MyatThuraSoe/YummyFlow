import {
  deleteFeedback,
  getItemFeedback,
  submitFeedback,
} from "../controllers/feedback";
import {
  deleteMenuItem,
  getMenuItems,
  updateMenuItem,
  createMenu,
  getMenuItemById,
  generateMenuItem,
  smartMenu,
} from "../controllers/menu";
import { checkRole } from "../middleware/checkRole";

import express from "express";
import { requirePermission } from "../middleware/requirePermission";
import { requireAuth } from "../middleware/requireAuth";
import { reviewLimiter, expensiveOpLimiter } from "../middleware/rateLimit";

const menuItemRouter = express.Router();

menuItemRouter.get("/", getMenuItems);

menuItemRouter.post(
  "/create",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  requirePermission("create", "menu"),
  createMenu,
);
menuItemRouter.post(
  "/:menuItemId/feedback",
  requireAuth,
  // Counted per user, not per IP, so several diners sharing one restaurant wifi
  // cannot throttle each other out of leaving a review.
  reviewLimiter,
  submitFeedback,
);

/**
 * Reviews for one dish.
 *
 * Public: the menu is public, so the rating shown next to a dish has to be too.
 * Only a display name and avatar are exposed — never the reviewer's email or id.
 */
menuItemRouter.get("/:menuItemId/feedback", getItemFeedback);

/** Self-service removal, plus an ADMIN/MANAGER moderation path. */
menuItemRouter.delete(
  "/feedback/:feedbackId",
  requireAuth,
  deleteFeedback,
);

menuItemRouter.patch(
  "/update/:id",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  requirePermission("update", "menu"),
  updateMenuItem,
);

menuItemRouter.delete(
  "/delete/:id",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  requirePermission("delete", "menu"),
  deleteMenuItem,
);

menuItemRouter.get("/:id", requireAuth, getMenuItemById);

menuItemRouter.post(
  "/smart-menu",
  requireAuth,
  // These two spend Gemini quota on every call, so they get their own budget.
  expensiveOpLimiter,
  checkRole(["ADMIN", "MANAGER"]),
  requirePermission("generate", "menu"),
  smartMenu,
);

menuItemRouter.post(
  "/generate-menu-item",
  requireAuth,
  expensiveOpLimiter,
  checkRole(["ADMIN", "MANAGER"]),
  requirePermission("generate", "menu"),
  generateMenuItem,
);

export default menuItemRouter;

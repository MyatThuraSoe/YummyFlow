import express from "express";

import {
  getDashboardCharts,
  getDashboardStats,
  getDashboardLists,
} from "../controllers/dashboard";
import { requireAuth } from "../middleware/requireAuth";
import { checkRole } from "../middleware/checkRole";
import { getSalesAnalytics } from "../controllers/analytics";

const dashboardRouter = express.Router();
dashboardRouter.get(
  "/stats",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  getDashboardStats,
);
dashboardRouter.get(
  "/charts",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  getDashboardCharts,
);
dashboardRouter.get(
  "/lists",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  getDashboardLists,
);

/**
 * Weekday-by-hour heatmap plus a ranked item list.
 *
 * Kept out of `/charts` on purpose — see the note at the top of
 * controllers/analytics.ts. Same management-only gate as its siblings.
 */
dashboardRouter.get(
  "/sales-analytics",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  getSalesAnalytics,
);

export default dashboardRouter;

import express from "express";
import { getDayClose } from "../controllers/reports";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";
import { checkRole } from "../middleware/checkRole";

const reportRouter = express.Router();

/**
 * Day-close / Z report.
 *
 * Gated on the `report` resource, which already existed in the access-control
 * statements but had no routes behind it. STAFF and KITCHEN hold `report: []`
 * on purpose — a shift close shows takings and voids, which is manager
 * information, not till information.
 */
reportRouter.get(
  "/day-close",
  requireAuth,
  requirePermission("view", "report"),
  checkRole(["ADMIN", "MANAGER"]),
  getDayClose,
);

export default reportRouter;

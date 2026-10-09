import express from "express";
import {
  createReservation,
  getReservations,
  updateReservationStatus,
} from "../controllers/reservation";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";
import { checkRole } from "../middleware/checkRole";
import { expensiveOpLimiter } from "../middleware/rateLimit";

const reservationRouter = express.Router();

reservationRouter.get(
  "/",
  requireAuth,
  requirePermission("read", "reservation"),
  checkRole(["ADMIN", "MANAGER", "CUSTOMER", "STAFF"]),
  getReservations,
);
reservationRouter.post(
  "/create",
  requireAuth,
  // Per-user, and ahead of the permission check so a flood is cheap to reject.
  // This route fans out a push notification to every ADMIN/MANAGER/STAFF device
  // (see notify.ts → sendToRoles), so an unbounded loop here was a way to spam
  // every manager's phone using one self-registered customer account.
  expensiveOpLimiter,
  requirePermission("create", "reservation"),
  checkRole(["ADMIN", "MANAGER", "CUSTOMER", "STAFF"]),
  createReservation,
);
reservationRouter.patch(
  "/:id/status",
  requireAuth,
  requirePermission("update", "reservation"),
  checkRole(["ADMIN", "MANAGER", "CUSTOMER", "STAFF"]),
  updateReservationStatus,
);

export default reservationRouter;

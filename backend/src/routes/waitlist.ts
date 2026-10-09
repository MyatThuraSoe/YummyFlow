import express from "express";
import {
  getWaitlist,
  getWaitlistPublic,
  joinWaitlist,
  removeWaitlistEntry,
  updateWaitlistStatus,
} from "../controllers/waitlist";
import { requireAuth } from "../middleware/requireAuth";
import { checkRole } from "../middleware/checkRole";
import { waitlistJoinLimiter } from "../middleware/rateLimit";

const waitlistRouter = express.Router();

/**
 * Walk-in queue.
 *
 * The public pair is deliberately unauthenticated: a walk-in at the door has no
 * account, and demanding one would make the feature pointless. Those two routes
 * return queue depth only — never another guest's name or number.
 */
waitlistRouter.get("/public", getWaitlistPublic);
waitlistRouter.post(
  "/join",
  // A real walk-in joins once. Per-IP and per 10 minutes, because there is no
  // account at the door to count against.
  waitlistJoinLimiter,
  joinWaitlist,
);

// The host desk. Seating a party is floor work, so STAFF are included — the
// same reasoning that lets waiters update table status.
waitlistRouter.get(
  "/",
  requireAuth,
  checkRole(["ADMIN", "MANAGER", "STAFF"]),
  getWaitlist,
);

waitlistRouter.patch(
  "/:id/status",
  requireAuth,
  checkRole(["ADMIN", "MANAGER", "STAFF"]),
  updateWaitlistStatus,
);

// Deleting a record rewrites the day's history, so it stays with management.
waitlistRouter.delete(
  "/:id/delete",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  removeWaitlistEntry,
);

export default waitlistRouter;

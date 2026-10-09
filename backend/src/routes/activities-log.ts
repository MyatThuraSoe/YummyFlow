import express from "express";

import { requireAuth } from "../middleware/requireAuth";
import { checkRole } from "../middleware/checkRole";
import { activitiesLog } from "../lib/activities-log";
import { getActivitiesLog } from "../controllers/activities-log";

const activitiesLogRouter = express.Router();

/**
 * The audit trail is staff-only, and these are the only two gates that matter
 * here.
 *
 * Both endpoints used to sit behind `requireAuth` alone, so any signed-in
 * CUSTOMER could read the entire cross-user audit trail — every other user's id,
 * action and timestamp — and could also POST arbitrary `action`/`details` rows
 * into it, forging entries in the very record that exists to prove what happened.
 * A forged trail is worse than no trail: it is evidence.
 *
 * There is no `audit` entry in the permissions `statements`, so this mirrors the
 * other admin-only reads (`/api/reports/day-close`, `/api/dashboard/*`) and
 * gates on role alone.
 *
 * Note the audit rows the application actually cares about are written
 * server-side by the controllers via `activitiesLog()`; nothing in the frontend
 * calls this POST.
 */
activitiesLogRouter.get(
  "/",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  getActivitiesLog,
);
activitiesLogRouter.post(
  "/create",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  async (req, res) => {
    try {
      const { action, details } = req.body;
      if (!action) {
        return res.status(400).json({ error: "action is required" });
      }
      await activitiesLog({
        userId: (req as any).user.id,
        action,
        details,
      });
      res.status(201).json({ message: "Activity log created successfully" });
    } catch (error) {
      console.error("Create activity log error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

export default activitiesLogRouter;

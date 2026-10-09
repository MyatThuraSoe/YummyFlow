import express from "express";
import {
  create,
  getAll,
  getById,
  remove,
  update,
  updateTableStatus,
} from "../controllers/table";
import { checkRole } from "../middleware/checkRole";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";

const tableRouter = express.Router();

tableRouter.get(
  "/",
  requireAuth,
  checkRole(["ADMIN", "MANAGER", "STAFF", "KITCHEN"]),
  requirePermission("read", "table"),
  getAll,
);

tableRouter.post(
  "/create",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  requirePermission("create", "table"),
  create,
);

tableRouter.patch(
  "/:id/update",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  requirePermission("update", "table"),
  update,
);

/**
 * Seating and clearing tables is floor work, so STAFF must be able to do it.
 * This was ADMIN/MANAGER only, which meant the people actually seating parties
 * and bussing tables could not update the floor plan at all.
 */
tableRouter.patch(
  "/:id/status",
  requireAuth,
  checkRole(["ADMIN", "MANAGER", "STAFF"]),
  requirePermission("update", "table"),
  updateTableStatus,
);

tableRouter.delete(
  "/:id/delete",
  requireAuth,
  checkRole(["ADMIN", "MANAGER"]),
  requirePermission("delete", "table"),
  remove,
);

tableRouter.get(
  "/:id",
  requireAuth,
  checkRole(["ADMIN", "MANAGER", "STAFF", "KITCHEN"]),
  requirePermission("read", "table"),
  getById,
);

export default tableRouter;

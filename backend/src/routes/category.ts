import {
  createCategory,
  deleteCategory,
  getCategories,
  updateCategory,
} from "../controllers/category";
import { checkRole } from "../middleware/checkRole";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";

import express from "express";

const categoryRouter = express.Router();
// we can add requireAuth and checkRole middleware to protect the routes as well as include user object in the request for further use in controllers
categoryRouter.post(
  "/create",
  requireAuth,
  requirePermission("create", "category"),
  checkRole(["ADMIN", "MANAGER"]),
  createCategory,
);
categoryRouter.get("/", getCategories);
categoryRouter.patch(
  "/update/:id",
  requireAuth,
  requirePermission("update", "category"),
  checkRole(["ADMIN", "MANAGER"]),
  updateCategory,
);
categoryRouter.delete(
  "/delete/:id",
  requireAuth,
  requirePermission("delete", "category"),
  checkRole(["ADMIN", "MANAGER"]),
  deleteCategory,
);

export default categoryRouter;

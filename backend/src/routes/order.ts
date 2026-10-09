import express from "express";
import {
  createPosOrder,
  getActiveOrders,
  getOrderById,
  getOrders,
  updateOrder,
  updateOrderPayment,
  updateOrderStatus,
} from "../controllers/order";
import { requireAuth } from "../middleware/requireAuth";
import { requirePermission } from "../middleware/requirePermission";
import { checkRole } from "../middleware/checkRole";

const orderRouter = express.Router();

orderRouter.post(
  "/",
  requireAuth,
  requirePermission("create", "order"),
  checkRole(["ADMIN", "MANAGER", "STAFF"]),
  createPosOrder,
);

/**
 * Every order still in flight, for the Kitchen Display and the POS board.
 *
 * Declared before any `/:id` route so "active" is never swallowed as an id.
 * Gated on the `kds` resource rather than `order` so chefs — who only have
 * `order: ["read"]` — can load their screen.
 */
orderRouter.get(
  "/active",
  requireAuth,
  requirePermission("view", "kds"),
  checkRole(["ADMIN", "MANAGER", "STAFF", "KITCHEN"]),
  getActiveOrders,
);

orderRouter.get(
  "/",
  requireAuth,
  requirePermission("read", "order"),
  checkRole(["ADMIN", "MANAGER", "STAFF"]),
  getOrders,
);

/**
 * A single order with its line prices — used to reprint a receipt.
 *
 * Declared after `/active` so the literal path wins, and before the `/:id`
 * PATCH routes for the same reason. KITCHEN holds `order: ["read"]` but is not
 * listed here: a kitchen ticket has no business carrying prices or payment
 * state.
 */
orderRouter.get(
  "/:id",
  requireAuth,
  requirePermission("read", "order"),
  checkRole(["ADMIN", "MANAGER", "STAFF"]),
  getOrderById,
);

/**
 * Status-only transition.
 *
 * This is the route the kitchen display and the floor use. It is deliberately
 * separate from the admin dynamic-update below so that payment method, payment
 * status and order type cannot be changed by anyone who merely works the pass.
 */
orderRouter.patch(
  "/:id/status",
  requireAuth,
  requirePermission("update_status", "kds"),
  checkRole(["ADMIN", "MANAGER", "STAFF", "KITCHEN"]),
  updateOrderStatus,
);

/**
 * Payment-only update. The till has to be able to take money, but it should not
 * inherit the ability to rewrite order type or status that the broad
 * dynamic-update route below grants.
 */
orderRouter.patch(
  "/:id/payment",
  requireAuth,
  requirePermission("update", "order"),
  checkRole(["ADMIN", "MANAGER", "STAFF"]),
  updateOrderPayment,
);

orderRouter.patch(
  "/:id",
  requireAuth,
  requirePermission("update", "order"),
  checkRole(["ADMIN", "MANAGER"]),
  updateOrder,
);

export default orderRouter;

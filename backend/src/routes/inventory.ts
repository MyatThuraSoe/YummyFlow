import express from "express";
import {
  createIngredient,
  deleteIngredient,
  getInventory,
  getRecipes,
  getStockMovements,
  restockIngredient,
  setRecipe,
  updateIngredient,
} from "../controllers/inventory";
import { requireAuth } from "../middleware/requireAuth";
import { checkRole } from "../middleware/checkRole";

const inventoryRouter = express.Router();

/**
 * Store management.
 *
 * Role-gated but deliberately not behind `requirePermission`: adding a
 * `inventory` resource would mean touching the access-control statements, every
 * role's grants, and the middleware's own allowlist — three files of blast
 * radius for a screen that is already restricted to management. This mirrors
 * how the dashboard router is gated. If inventory ever needs per-role
 * granularity, promote it to a proper resource then.
 */
inventoryRouter.use(requireAuth, checkRole(["ADMIN", "MANAGER"]));

/** Literal paths first so they are never swallowed by a `/:id` sibling. */
inventoryRouter.get("/movements", getStockMovements);
inventoryRouter.get("/recipes", getRecipes);
inventoryRouter.post("/recipes/:menuItemId", setRecipe);

inventoryRouter.get("/", getInventory);
inventoryRouter.post("/create", createIngredient);
inventoryRouter.patch("/update/:id", updateIngredient);
inventoryRouter.patch("/restock/:id", restockIngredient);
inventoryRouter.delete("/delete/:id", deleteIngredient);

export default inventoryRouter;

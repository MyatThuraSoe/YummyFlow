import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { adjustStock } from "../services/inventory.service.js";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);
inventoryRouter.use(requirePermission("inventory.view"));

inventoryRouter.get(
  "/ingredients",
  asyncHandler(async (req, res) => {
    const ingredients = await prisma.ingredient.findMany({
      where: { restaurantId: req.auth!.restaurantId, isActive: true },
      orderBy: { name: "asc" },
    });
    res.json({ ingredients });
  }),
);

const ingredientSchema = z.object({
  name: z.string().min(1),
  stockUnit: z.string().min(1).optional(),
  purchaseUnit: z.string().optional().nullable(),
  conversionFactor: z.number().positive().optional(),
  currentStock: z.number().optional(),
  reorderLevel: z.number().nonnegative().optional().nullable(),
  costPerUnit: z.number().nonnegative().optional(),
});

inventoryRouter.post(
  "/ingredients",
  requirePermission("inventory.manage"),
  validate({ body: ingredientSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof ingredientSchema>;
    const ingredient = await prisma.ingredient.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        name: b.name,
        stockUnit: b.stockUnit ?? "unit",
        purchaseUnit: b.purchaseUnit ?? null,
        conversionFactor: (b.conversionFactor ?? 1).toFixed(4),
        currentStock: (b.currentStock ?? 0).toFixed(4),
        reorderLevel: b.reorderLevel !== undefined && b.reorderLevel !== null ? b.reorderLevel.toFixed(4) : null,
        costPerUnit: (b.costPerUnit ?? 0).toFixed(4),
      },
    });
    res.status(201).json({ ingredient });
  }),
);

inventoryRouter.patch(
  "/ingredients/:id",
  requirePermission("inventory.manage"),
  validate({ body: ingredientSchema.partial() }),
  asyncHandler(async (req, res) => {
    const b = req.body as Partial<z.infer<typeof ingredientSchema>>;
    const ingredient = await prisma.ingredient.update({
      where: { id: String(req.params.id) },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.stockUnit !== undefined ? { stockUnit: b.stockUnit } : {}),
        ...(b.reorderLevel !== undefined ? { reorderLevel: b.reorderLevel === null ? null : b.reorderLevel.toFixed(4) } : {}),
        ...(b.costPerUnit !== undefined ? { costPerUnit: b.costPerUnit.toFixed(4) } : {}),
      },
    });
    res.json({ ingredient });
  }),
);

const adjustSchema = z.object({
  quantity: z.number(),
  type: z.enum(["PURCHASE_RECEIPT", "WASTAGE", "STOCKTAKE_ADJUSTMENT", "RETURN"]),
  reason: z.string().optional(),
  unitCost: z.number().nonnegative().optional(),
});

inventoryRouter.post(
  "/ingredients/:id/adjust",
  requirePermission("inventory.manage"),
  validate({ body: adjustSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof adjustSchema>;
    const ingredient = await adjustStock({
      restaurantId: req.auth!.restaurantId,
      ingredientId: String(req.params.id),
      quantity: b.quantity,
      type: b.type,
      reason: b.reason,
      unitCost: b.unitCost,
      actorId: req.auth!.userId,
    });
    res.json({ ingredient });
  }),
);

inventoryRouter.get(
  "/movements",
  asyncHandler(async (req, res) => {
    const { ingredientId, limit } = req.query as Record<string, string | undefined>;
    const movements = await prisma.stockMovement.findMany({
      where: { restaurantId: req.auth!.restaurantId, ...(ingredientId ? { ingredientId } : {}) },
      include: { ingredient: { select: { name: true, stockUnit: true } } },
      orderBy: { createdAt: "desc" },
      take: limit ? Math.min(Number(limit), 500) : 100,
    });
    res.json({ movements });
  }),
);

// ── Recipes ─────────────────────────────────────────────
inventoryRouter.get(
  "/items/:menuItemId/recipe",
  asyncHandler(async (req, res) => {
    const lines = await prisma.recipeLine.findMany({
      where: { menuItemId: String(req.params.menuItemId), effectiveTo: null },
      include: { ingredient: true },
    });
    res.json({ lines });
  }),
);

const recipeSchema = z.object({
  lines: z.array(z.object({ ingredientId: z.string().uuid(), quantity: z.number().positive() })),
});

inventoryRouter.put(
  "/items/:menuItemId/recipe",
  requirePermission("inventory.manage"),
  validate({ body: recipeSchema }),
  asyncHandler(async (req, res) => {
    const { lines } = req.body as z.infer<typeof recipeSchema>;
    const item = await prisma.menuItem.findUnique({ where: { id: String(req.params.menuItemId) } });
    if (!item) throw ApiError.notFound("Menu item not found");
    await prisma.$transaction([
      prisma.recipeLine.updateMany({ where: { menuItemId: item.id, effectiveTo: null }, data: { effectiveTo: new Date() } }),
      prisma.recipeLine.createMany({
        data: lines.map((l) => ({ menuItemId: item.id, ingredientId: l.ingredientId, quantity: l.quantity.toFixed(4) })),
      }),
    ]);
    res.json({ ok: true });
  }),
);

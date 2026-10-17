import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit } from "../lib/audit.js";
import { fromCents, toCents } from "../lib/money.js";
import { assertWithinLimit } from "../lib/license.js";
import { toggleItemAvailability } from "../services/kitchen.service.js";

export const menuRouter = Router();
menuRouter.use(requireAuth);

const stationEnum = z.enum(["GRILL", "FRYER", "SALAD", "BAR", "DESSERT", "KITCHEN"]);

/** Full menu for POS/tablet — only available + active items by default. */
menuRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const includeUnavailable = req.query.all === "true";
    const categories = await prisma.menuCategory.findMany({
      where: { restaurantId: req.auth!.restaurantId, isActive: true },
      orderBy: { displayOrder: "asc" },
      include: {
        items: {
          where: includeUnavailable ? { isActive: true } : { isActive: true, isAvailable: true },
          orderBy: { name: "asc" },
          include: {
            variants: true,
            modifierGroups: { include: { options: true } },
          },
        },
      },
    });
    res.json({ categories });
  }),
);

menuRouter.get(
  "/items/:id",
  asyncHandler(async (req, res) => {
    const item = await prisma.menuItem.findUnique({
      where: { id: String(req.params.id) },
      include: { variants: true, modifierGroups: { include: { options: true } }, category: true, recipeLines: { include: { ingredient: true } } },
    });
    if (!item) throw ApiError.notFound("Menu item not found");
    res.json({ item });
  }),
);

// ── Menu management (ADMIN/OWNER) ──────────────────────────────

const categorySchema = z.object({
  name: z.string().min(1).max(60),
  displayOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

menuRouter.post(
  "/categories",
  requirePermission("menu.manage"),
  validate({ body: categorySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof categorySchema>;
    const cat = await prisma.menuCategory.create({
      data: { restaurantId: req.auth!.restaurantId, name: body.name, displayOrder: body.displayOrder ?? 0 },
    });
    res.status(201).json({ category: cat });
  }),
);

menuRouter.patch(
  "/categories/:id",
  requirePermission("menu.manage"),
  validate({ body: categorySchema.partial() }),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof categorySchema>>;
    const cat = await prisma.menuCategory.update({ where: { id: String(req.params.id) }, data: body });
    res.json({ category: cat });
  }),
);

menuRouter.delete(
  "/categories/:id",
  requirePermission("menu.manage"),
  asyncHandler(async (req, res) => {
    await prisma.menuCategory.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    res.json({ ok: true });
  }),
);

const itemSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional().nullable(),
  price: z.number().nonnegative(),
  station: stationEnum.optional(),
  prepTime: z.number().int().min(0).optional(),
  isAvailable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  variants: z.array(z.object({ name: z.string(), priceAdjust: z.number() })).optional(),
  modifierGroups: z
    .array(
      z.object({
        name: z.string(),
        required: z.boolean().optional(),
        minSelect: z.number().int().min(0).optional(),
        maxSelect: z.number().int().min(0).optional().nullable(),
        options: z.array(z.object({ name: z.string(), price: z.number() })).optional(),
      }),
    )
    .optional(),
});

menuRouter.post(
  "/items",
  requirePermission("menu.manage"),
  validate({ body: itemSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof itemSchema>;
    assertWithinLimit("menuItems", await prisma.menuItem.count({ where: { category: { restaurantId: req.auth!.restaurantId } } }));
    const item = await prisma.menuItem.create({
      data: {
        categoryId: body.categoryId,
        name: body.name,
        description: body.description ?? null,
        price: fromCents(toCents(body.price)),
        station: body.station ?? "KITCHEN",
        prepTime: body.prepTime ?? 10,
        variants: body.variants ? { createMany: { data: body.variants.map((v) => ({ name: v.name, priceAdjust: fromCents(toCents(v.priceAdjust)) })) } } : undefined,
        modifierGroups: body.modifierGroups
          ? {
              create: body.modifierGroups.map((g) => ({
                name: g.name,
                required: g.required ?? false,
                minSelect: g.minSelect ?? 0,
                maxSelect: g.maxSelect ?? null,
                options: g.options ? { createMany: { data: g.options.map((o) => ({ name: o.name, price: fromCents(toCents(o.price)) })) } } : undefined,
              })),
            }
          : undefined,
      },
      include: { variants: true, modifierGroups: { include: { options: true } } },
    });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "MENU_ITEM_CREATED", entityType: "MenuItem", entityId: item.id });
    res.status(201).json({ item });
  }),
);

menuRouter.patch(
  "/items/:id",
  requirePermission("menu.manage"),
  validate({ body: itemSchema.partial() }),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof itemSchema>>;
    const { variants, modifierGroups, price, ...rest } = body;
    void variants;
    void modifierGroups;
    const item = await prisma.menuItem.update({
      where: { id: String(req.params.id) },
      data: { ...rest, ...(price !== undefined ? { price: fromCents(toCents(price)) } : {}) },
    });
    res.json({ item });
  }),
);

menuRouter.delete(
  "/items/:id",
  requirePermission("menu.manage"),
  asyncHandler(async (req, res) => {
    await prisma.menuItem.update({ where: { id: String(req.params.id) }, data: { isActive: false } });
    res.json({ ok: true });
  }),
);

const toggleSchema = z.object({ isAvailable: z.boolean(), reason: z.string().optional() });

menuRouter.post(
  "/items/:id/availability",
  requirePermission("menu.manage"),
  validate({ body: toggleSchema }),
  asyncHandler(async (req, res) => {
    const { isAvailable, reason } = req.body as z.infer<typeof toggleSchema>;
    const updated = await toggleItemAvailability(String(req.params.id), isAvailable, req.auth!.userId, reason);
    res.json({ item: updated });
  }),
);

// ── Variants ────────────────────────────────────────────
const variantSchema = z.object({
  name: z.string().min(1).max(60),
  priceAdjust: z.number().optional(),
  isAvailable: z.boolean().optional(),
});

menuRouter.post(
  "/items/:id/variants",
  requirePermission("menu.manage"),
  validate({ body: variantSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof variantSchema>;
    const item = await prisma.menuItem.findUnique({ where: { id: String(req.params.id) } });
    if (!item) throw ApiError.notFound("Menu item not found");
    const variant = await prisma.menuVariant.create({
      data: {
        menuItemId: item.id,
        name: body.name,
        priceAdjust: fromCents(toCents(body.priceAdjust ?? 0)),
        isAvailable: body.isAvailable ?? true,
      },
    });
    res.status(201).json({ variant });
  }),
);

menuRouter.patch(
  "/variants/:id",
  requirePermission("menu.manage"),
  validate({ body: variantSchema.partial() }),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof variantSchema>>;
    const variant = await prisma.menuVariant.update({
      where: { id: String(req.params.id) },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.priceAdjust !== undefined ? { priceAdjust: fromCents(toCents(body.priceAdjust)) } : {}),
        ...(body.isAvailable !== undefined ? { isAvailable: body.isAvailable } : {}),
      },
    });
    res.json({ variant });
  }),
);

menuRouter.delete(
  "/variants/:id",
  requirePermission("menu.manage"),
  asyncHandler(async (req, res) => {
    await prisma.menuVariant.delete({ where: { id: String(req.params.id) } });
    res.json({ ok: true });
  }),
);

// ── Modifier groups + options ───────────────────────────
const modifierGroupSchema = z.object({
  name: z.string().min(1).max(60),
  required: z.boolean().optional(),
  minSelect: z.number().int().min(0).optional(),
  maxSelect: z.number().int().min(0).nullable().optional(),
});

menuRouter.post(
  "/items/:id/modifier-groups",
  requirePermission("menu.manage"),
  validate({ body: modifierGroupSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof modifierGroupSchema>;
    const item = await prisma.menuItem.findUnique({ where: { id: String(req.params.id) } });
    if (!item) throw ApiError.notFound("Menu item not found");
    const group = await prisma.modifierGroup.create({
      data: {
        menuItemId: item.id,
        name: body.name,
        required: body.required ?? false,
        minSelect: body.minSelect ?? 0,
        maxSelect: body.maxSelect ?? null,
      },
      include: { options: true },
    });
    res.status(201).json({ group });
  }),
);

menuRouter.patch(
  "/modifier-groups/:id",
  requirePermission("menu.manage"),
  validate({ body: modifierGroupSchema.partial() }),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof modifierGroupSchema>>;
    const group = await prisma.modifierGroup.update({
      where: { id: String(req.params.id) },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.required !== undefined ? { required: body.required } : {}),
        ...(body.minSelect !== undefined ? { minSelect: body.minSelect } : {}),
        ...(body.maxSelect !== undefined ? { maxSelect: body.maxSelect } : {}),
      },
      include: { options: true },
    });
    res.json({ group });
  }),
);

menuRouter.delete(
  "/modifier-groups/:id",
  requirePermission("menu.manage"),
  asyncHandler(async (req, res) => {
    await prisma.modifierGroup.delete({ where: { id: String(req.params.id) } });
    res.json({ ok: true });
  }),
);

const modifierOptionSchema = z.object({
  name: z.string().min(1).max(60),
  price: z.number().optional(),
  isAvailable: z.boolean().optional(),
});

menuRouter.post(
  "/modifier-groups/:id/options",
  requirePermission("menu.manage"),
  validate({ body: modifierOptionSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof modifierOptionSchema>;
    const group = await prisma.modifierGroup.findUnique({ where: { id: String(req.params.id) } });
    if (!group) throw ApiError.notFound("Modifier group not found");
    const option = await prisma.modifierOption.create({
      data: { groupId: group.id, name: body.name, price: fromCents(toCents(body.price ?? 0)), isAvailable: body.isAvailable ?? true },
    });
    res.status(201).json({ option });
  }),
);

menuRouter.patch(
  "/modifier-options/:id",
  requirePermission("menu.manage"),
  validate({ body: modifierOptionSchema.partial() }),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof modifierOptionSchema>>;
    const option = await prisma.modifierOption.update({
      where: { id: String(req.params.id) },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.price !== undefined ? { price: fromCents(toCents(body.price)) } : {}),
        ...(body.isAvailable !== undefined ? { isAvailable: body.isAvailable } : {}),
      },
    });
    res.json({ option });
  }),
);

menuRouter.delete(
  "/modifier-options/:id",
  requirePermission("menu.manage"),
  asyncHandler(async (req, res) => {
    await prisma.modifierOption.delete({ where: { id: String(req.params.id) } });
    res.json({ ok: true });
  }),
);

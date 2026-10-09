import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { activitiesLog } from "../lib/activities-log";
import { getIO } from "../lib/socket";

/**
 * Store management: what is on hand, what each dish consumes, and the audit log
 * behind both.
 *
 * The balances live on `Ingredient.quantity` so a read is one query, but every
 * change also writes a `StockMovement`. Without that ledger a stock count that
 * disagrees with the books is unexplainable, and an unexplainable count is a
 * count nobody trusts.
 */

const round3 = (n: number) => Number(n.toFixed(3));

/** On hand, at or below the reorder point, and out entirely. */
export type StockLevel = "OUT" | "LOW" | "OK";

const levelOf = (quantity: number, reorderAt: number): StockLevel => {
  if (quantity <= 0) return "OUT";
  if (reorderAt > 0 && quantity <= reorderAt) return "LOW";
  return "OK";
};

/** Everything the inventory page needs in one response. */
export const getInventory = async (_req: Request, res: Response) => {
  try {
    const ingredients = await prisma.ingredient.findMany({
      orderBy: { name: "asc" },
      include: {
        recipeItems: {
          select: {
            quantity: true,
            menuItem: { select: { id: true, name: true } },
          },
        },
      },
    });

    const lowStock = ingredients
      .filter((i) => levelOf(i.quantity, i.reorderAt) !== "OK")
      .map((i) => i.name);

    res.status(200).json({
      data: ingredients.map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        quantity: round3(i.quantity),
        reorderAt: round3(i.reorderAt),
        costPerUnit: i.costPerUnit,
        level: levelOf(i.quantity, i.reorderAt),
        usedIn: i.recipeItems.map((r) => ({
          menuItemId: r.menuItem.id,
          name: r.menuItem.name,
          // Total this dish draws down across the whole menu it appears in.
          perServing: round3(r.quantity),
        })),
        updatedAt: i.updatedAt,
      })),
      lowStock,
      counts: {
        total: ingredients.length,
        low: lowStock.length,
      },
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching inventory:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const createIngredient = async (req: Request, res: Response) => {
  try {
    const { name, unit, quantity, reorderAt, costPerUnit } = req.body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Ingredient name is required" });
    }

    const initialQty = Number(quantity ?? 0);
    const reorder = Number(reorderAt ?? 0);

    if (!Number.isFinite(initialQty) || initialQty < 0) {
      return res.status(400).json({ error: "Quantity must be zero or more" });
    }

    if (!Number.isFinite(reorder) || reorder < 0) {
      return res
        .status(400)
        .json({ error: "Reorder level must be zero or more" });
    }

    const trimmed = name.trim();

    // Case-insensitive guard: `@unique` is case-sensitive, so "Tomato" and
    // "tomato" would otherwise be two rows that both decrement on the same dish.
    const clash = await prisma.ingredient.findFirst({
      where: { name: { equals: trimmed, mode: "insensitive" } },
    });
    if (clash) {
      return res
        .status(409)
        .json({ error: `An ingredient named "${clash.name}" already exists` });
    }

    const ingredient = await prisma.ingredient.create({
      data: {
        name: trimmed,
        unit: unit || "unit",
        quantity: initialQty,
        reorderAt: reorder,
        costPerUnit:
          costPerUnit === undefined || costPerUnit === null
            ? null
            : Number(costPerUnit),
      },
    });

    // Opening balance is a real movement, not a creation artefact — otherwise
    // the ledger starts life unable to explain the stock that is already there.
    if (initialQty > 0) {
      await prisma.stockMovement.create({
        data: {
          ingredientId: ingredient.id,
          delta: initialQty,
          reason: "RESTOCK",
          note: "Opening balance",
        },
      });
    }

    await activitiesLog({
      userId: (req as any).user?.id,
      action: "CREATE_INGREDIENT",
      details: `${trimmed} added with ${initialQty} ${ingredient.unit}`,
    });

    getIO().emit("inventory-updated");

    res.status(201).json(ingredient);
  } catch (error) {
    console.error("Error creating ingredient:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const updateIngredient = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { name, unit, reorderAt, costPerUnit } = req.body ?? {};

    const existing = await prisma.ingredient.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Ingredient not found" });
    }

    // Quantity is deliberately not editable here. Changing a balance without a
    // reason is a mystery; the count goes through `restockIngredient`, which
    // writes a movement explaining it.
    const reorder =
      reorderAt === undefined ? existing.reorderAt : Number(reorderAt);

    if (!Number.isFinite(reorder) || reorder < 0) {
      return res
        .status(400)
        .json({ error: "Reorder level must be zero or more" });
    }

    const updated = await prisma.ingredient.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(unit !== undefined ? { unit } : {}),
        reorderAt: reorder,
        ...(costPerUnit !== undefined
          ? { costPerUnit: costPerUnit === null ? null : Number(costPerUnit) }
          : {}),
      },
    });

    await activitiesLog({
      userId: (req as any).user?.id,
      action: "UPDATE_INGREDIENT",
      details: `${updated.name} details updated`,
    });

    getIO().emit("inventory-updated");

    res.status(200).json(updated);
  } catch (error) {
    console.error("Error updating ingredient:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const RESTOCK_REASONS = ["RESTOCK", "WASTE", "ADJUSTMENT"] as const;
type RestockReason = (typeof RESTOCK_REASONS)[number];

const isRestockReason = (v: unknown): v is RestockReason =>
  typeof v === "string" &&
  (RESTOCK_REASONS as readonly string[]).includes(v);

/**
 * Correct a balance by a signed amount and record why.
 *
 * A restock and a write-off are the same arithmetic with different intent, so
 * they share an endpoint and differ only by `reason` — which is exactly the
 * distinction an audit needs to keep.
 */
export const restockIngredient = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { delta, reason, note } = req.body ?? {};

    const amount = Number(delta);
    if (!Number.isFinite(amount) || amount === 0) {
      return res
        .status(400)
        .json({ error: "Delta must be a non-zero number" });
    }

    if (!isRestockReason(reason)) {
      return res.status(400).json({
        error: `Reason must be one of ${RESTOCK_REASONS.join(", ")}`,
      });
    }

    const ingredient = await prisma.ingredient.findUnique({ where: { id } });
    if (!ingredient) {
      return res.status(404).json({ message: "Ingredient not found" });
    }

    // Waste and corrections cannot drive a balance below zero. A restock can.
    const next = round3(ingredient.quantity + amount);
    if (next < 0) {
      return res.status(400).json({
        error: `Cannot apply ${amount} ${ingredient.unit} — only ${ingredient.quantity} on hand`,
      });
    }

    const [updated] = await prisma.$transaction([
      prisma.ingredient.update({
        where: { id },
        data: { quantity: next },
      }),
      prisma.stockMovement.create({
        data: {
          ingredientId: id,
          delta: amount,
          reason,
          note: note ? String(note).slice(0, 280) : null,
        },
      }),
    ]);

    await activitiesLog({
      userId: (req as any).user?.id,
      action: "RESTOCK_INGREDIENT",
      details: `${ingredient.name} ${amount > 0 ? "+" : ""}${amount} ${ingredient.unit} (${reason})`,
    });

    getIO().emit("inventory-updated");

    res.status(200).json(updated);
  } catch (error) {
    console.error("Error restocking ingredient:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** Remove an ingredient entirely. Recipes referencing it cascade away. */
export const deleteIngredient = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    const ingredient = await prisma.ingredient.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { recipeItems: true } } },
    });

    if (!ingredient) {
      return res.status(404).json({ message: "Ingredient not found" });
    }

    await prisma.ingredient.delete({ where: { id } });

    await activitiesLog({
      userId: (req as any).user?.id,
      action: "DELETE_INGREDIENT",
      details: `${ingredient.name} removed from ${ingredient._count.recipeItems} dish(es)`,
    });

    getIO().emit("inventory-updated");

    res.status(200).json({ message: "Ingredient deleted successfully" });
  } catch (error) {
    console.error("Error deleting ingredient:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Replace a dish's recipe wholesale.
 *
 * A PUT rather than a per-line POST/DELETE: the admin form edits the whole
 * ingredient list at once, and diffing it server-side would only add ways to
 * end up with the same ingredient listed twice.
 */
export const setRecipe = async (req: Request, res: Response) => {
  try {
    const { menuItemId } = req.params as { menuItemId: string };
    const { items } = req.body ?? {};

    const menuItem = await prisma.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, name: true },
    });
    if (!menuItem) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items must be an array" });
    }

    const seen = new Set<string>();
    const parsed: { ingredientId: string; quantity: number }[] = [];

    for (const raw of items) {
      const ingredientId = String(raw?.ingredientId ?? "");
      const quantity = Number(raw?.quantity);

      if (!ingredientId) {
        return res.status(400).json({ error: "Every line needs an ingredientId" });
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res
          .status(400)
          .json({ error: "Each line needs a quantity greater than zero" });
      }
      if (seen.has(ingredientId)) {
        return res
          .status(400)
          .json({ error: "The same ingredient is listed twice" });
      }
      seen.add(ingredientId);
      parsed.push({ ingredientId, quantity: round3(quantity) });
    }

    const known = await prisma.ingredient.findMany({
      where: { id: { in: parsed.map((p) => p.ingredientId) } },
      select: { id: true },
    });
    if (known.length !== parsed.length) {
      return res
        .status(400)
        .json({ error: "One or more ingredients no longer exist" });
    }

    const recipe = await prisma.$transaction(async (tx) => {
      await tx.recipeItem.deleteMany({ where: { menuItemId } });
      if (parsed.length > 0) {
        await tx.recipeItem.createMany({
          data: parsed.map((p) => ({ ...p, menuItemId })),
        });
      }
      return tx.recipeItem.findMany({
        where: { menuItemId },
        orderBy: { ingredient: { name: "asc" } },
        include: { ingredient: true },
      });
    });

    await activitiesLog({
      userId: (req as any).user?.id,
      action: "UPDATE_RECIPE",
      details: `${menuItem.name} recipe set to ${parsed.length} ingredient(s)`,
    });

    getIO().emit("inventory-updated");

    res.status(200).json({ data: recipe });
  } catch (error) {
    console.error("Error setting recipe:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** Dishes plus the ingredients they currently draw down. */
export const getRecipes = async (_req: Request, res: Response) => {
  try {
    const menuItems = await prisma.menuItem.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        isAvailable: true,
        recipeItems: {
          select: {
            quantity: true,
            ingredient: {
              select: { id: true, name: true, unit: true, quantity: true },
            },
          },
        },
      },
    });

    res.status(200).json({
      data: menuItems.map((m) => ({
        id: m.id,
        name: m.name,
        isAvailable: m.isAvailable,
        // A dish with no rows is not "broken", it simply has no recipe yet and
        // never decrements stock. Surfaced as 0 so the admin page can sort on it.
        ingredientCount: m.recipeItems.length,
        items: m.recipeItems.map((r) => ({
          ingredientId: r.ingredient.id,
          name: r.ingredient.name,
          unit: r.ingredient.unit,
          onHand: round3(r.ingredient.quantity),
          perServing: round3(r.quantity),
          // Servings possible from what is on hand — the number a kitchen
          // actually cares about when deciding whether to run the dish tonight.
          servingsLeft:
            r.quantity > 0
              ? Math.floor(r.ingredient.quantity / r.quantity)
              : null,
        })),
      })),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching recipes:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/** The stock ledger, newest first. */
export const getStockMovements = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

    const movements = await prisma.stockMovement.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        ingredient: { select: { name: true, unit: true } },
      },
    });

    res.status(200).json({
      data: movements.map((m) => ({
        id: m.id,
        ingredient: m.ingredient.name,
        unit: m.ingredient.unit,
        delta: round3(m.delta),
        reason: m.reason,
        orderId: m.orderId,
        note: m.note,
        createdAt: m.createdAt,
      })),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching stock movements:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

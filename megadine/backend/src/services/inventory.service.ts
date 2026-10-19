import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { EVENTS, emitToRole } from "../lib/socket.js";
import type { Prisma, StockMovementType } from "@prisma/client";

function dec(n: number) {
  return n.toFixed(4);
}

export interface LowStockWarning {
  ingredientId: string;
  name: string;
  stock: number;
  reorderLevel: number | null;
  unit: string;
}

/**
 * Deduct recipe ingredients for an order (theoretical consumption). Runs the
 * first time an order is served or paid; `Order.inventoryConsumedAt` makes it
 * idempotent so serving then paying never double-deducts. Sales are allowed
 * to push stock negative but trigger a low-stock warning; manual adjustments
 * are hard-blocked (see adjustStock).
 */
export async function consumeForOrder(tx: Prisma.TransactionClient, orderId: string): Promise<LowStockWarning[]> {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { inventoryConsumedAt: true } });
  if (!order || order.inventoryConsumedAt) return [];

  const lines = await tx.orderLine.findMany({
    where: { orderId, isVoided: false },
    include: {
      menuItem: { include: { recipeLines: { where: { effectiveTo: null }, include: { ingredient: true } } } },
    },
  });

  const warnings: LowStockWarning[] = [];

  for (const line of lines) {
    for (const recipe of line.menuItem.recipeLines) {
      const used = Number(recipe.quantity) * line.quantity;
      if (used <= 0) continue;
      const newStock = Number(recipe.ingredient.currentStock) - used;
      await tx.ingredient.update({
        where: { id: recipe.ingredientId },
        data: { currentStock: dec(newStock) },
      });
      await tx.stockMovement.create({
        data: {
          restaurantId: recipe.ingredient.restaurantId,
          ingredientId: recipe.ingredientId,
          type: "SALE_CONSUMPTION",
          quantity: dec(-used),
          unitCost: recipe.ingredient.costPerUnit.toString(),
          reference: orderId,
          actorId: "system",
        },
      });
      const reorderLevel = recipe.ingredient.reorderLevel !== null ? Number(recipe.ingredient.reorderLevel) : null;
      if (newStock <= (reorderLevel ?? 0)) {
        warnings.push({
          ingredientId: recipe.ingredientId,
          name: recipe.ingredient.name,
          stock: newStock,
          reorderLevel,
          unit: recipe.ingredient.stockUnit,
        });
      }
    }
  }

  await tx.order.update({ where: { id: orderId }, data: { inventoryConsumedAt: new Date() } });
  for (const w of warnings) emitToRole("ADMIN", EVENTS.INVENTORY_LOW, w);
  return warnings;
}

export interface AdjustInput {
  restaurantId: string;
  ingredientId: string;
  quantity: number; // signed (negative reduces)
  type: StockMovementType;
  reason?: string;
  unitCost?: number;
  actorId: string;
}

export async function adjustStock(input: AdjustInput) {
  const ingredient = await prisma.ingredient.findUnique({ where: { id: input.ingredientId } });
  if (!ingredient) throw ApiError.notFound("Ingredient not found");

  const newStock = Number(ingredient.currentStock) + input.quantity;
  const manualTypes: StockMovementType[] = ["WASTAGE", "STOCKTAKE_ADJUSTMENT", "PURCHASE_RECEIPT", "RETURN"];
  if (manualTypes.includes(input.type) && newStock < 0) {
    throw ApiError.conflict(
      `Insufficient stock for "${ingredient.name}": have ${Number(ingredient.currentStock)}, need ${Math.abs(input.quantity)}`,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const ing = await tx.ingredient.update({
      where: { id: input.ingredientId },
      data: {
        currentStock: dec(newStock),
        ...(input.unitCost !== undefined ? { costPerUnit: dec(input.unitCost) } : {}),
      },
    });
    await tx.stockMovement.create({
      data: {
        restaurantId: input.restaurantId,
        ingredientId: input.ingredientId,
        type: input.type,
        quantity: dec(input.quantity),
        unitCost: input.unitCost !== undefined ? dec(input.unitCost) : ingredient.costPerUnit.toString(),
        reason: input.reason,
        actorId: input.actorId,
      },
    });
    return ing;
  });

  await audit({
    restaurantId: input.restaurantId,
    userId: input.actorId,
    action: `INVENTORY_${input.type}`,
    entityType: "Ingredient",
    entityId: input.ingredientId,
    before: { stock: ingredient.currentStock.toString() },
    after: { stock: updated.currentStock.toString() },
    reason: input.reason ?? null,
  });

  return updated;
}

export const WASTAGE_REASONS = ["burned", "dropped", "expired", "over-prepared", "other"] as const;
export type WastageReason = (typeof WASTAGE_REASONS)[number];

export interface WastageInput {
  restaurantId: string;
  ingredientId: string;
  quantity: number;
  reason: WastageReason;
  note?: string;
  actorId: string;
}

/**
 * Record kitchen waste against an ingredient. Unlike sale consumption this is
 * a manual action, so it is hard-blocked when it would push stock negative
 * (matching adjustStock).
 */
export async function recordWastage(input: WastageInput) {
  const ingredient = await prisma.ingredient.findUnique({ where: { id: input.ingredientId } });
  if (!ingredient || ingredient.restaurantId !== input.restaurantId) throw ApiError.notFound("Ingredient not found");
  if (input.quantity <= 0) throw ApiError.badRequest("Wastage quantity must be positive");

  const newStock = Number(ingredient.currentStock) - input.quantity;
  if (newStock < 0) {
    throw ApiError.conflict(
      `Insufficient stock for "${ingredient.name}": have ${Number(ingredient.currentStock)}, need ${input.quantity}`,
    );
  }

  const { updated, movement } = await prisma.$transaction(async (tx) => {
    const ing = await tx.ingredient.update({
      where: { id: ingredient.id },
      data: { currentStock: dec(newStock) },
    });
    const mv = await tx.stockMovement.create({
      data: {
        restaurantId: input.restaurantId,
        ingredientId: ingredient.id,
        type: "WASTAGE",
        quantity: dec(-input.quantity),
        unitCost: ingredient.costPerUnit.toString(),
        reason: input.reason,
        note: input.note ?? null,
        actorId: input.actorId,
      },
    });
    return { updated: ing, movement: mv };
  });

  await audit({
    restaurantId: input.restaurantId,
    userId: input.actorId,
    action: "INVENTORY_WASTAGE",
    entityType: "Ingredient",
    entityId: ingredient.id,
    before: { stock: ingredient.currentStock.toString() },
    after: { stock: updated.currentStock.toString(), cost: (input.quantity * Number(ingredient.costPerUnit)).toFixed(2) },
    reason: input.note ? `${input.reason}: ${input.note}` : input.reason,
  });

  const reorderLevel = ingredient.reorderLevel !== null ? Number(ingredient.reorderLevel) : null;
  if (newStock <= (reorderLevel ?? 0)) {
    emitToRole("ADMIN", EVENTS.INVENTORY_LOW, {
      ingredientId: ingredient.id,
      name: ingredient.name,
      stock: newStock,
      reorderLevel,
      unit: ingredient.stockUnit,
    });
  }

  return { ingredient: updated, movement };
}

export async function theoreticalUsageCost(restaurantId: string, from: Date, to: Date) {
  const movements = await prisma.stockMovement.findMany({
    where: {
      restaurantId,
      type: "SALE_CONSUMPTION",
      createdAt: { gte: from, lte: to },
    },
    include: { ingredient: true },
  });
  return movements.reduce(
    (sum, m) => sum + Math.abs(Number(m.quantity)) * Number(m.unitCost ?? m.ingredient.costPerUnit),
    0,
  );
}

export async function foodCostPercent(restaurantId: string, from: Date, to: Date) {
  const [usage, sales] = await Promise.all([
    theoreticalUsageCost(restaurantId, from, to),
    prisma.order.aggregate({
      where: { restaurantId, status: "COMPLETED", businessDate: { gte: from, lte: to } },
      _sum: { subtotal: true },
    }),
  ]);
  const netSales = Number(sales._sum.subtotal ?? 0);
  return {
    usageCost: usage,
    netSales,
    foodCostPercent: netSales > 0 ? usage / netSales : 0,
  };
}

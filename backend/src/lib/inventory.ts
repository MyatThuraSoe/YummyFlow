/**
 * Stock consumption and restoration.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SEPARATE
 * ---------------------------------------------------------------------------
 * Stock is written from two very different places — the POS order controller
 * (inside a transaction, with a `tx` client) and the void/restore path (also
 * transactional, but reading back what the original order consumed) — plus a
 * read-side path that has to undo consumption when an order is voided.
 * Duplicating the arithmetic in each place is how the ledger and the balance
 * drift apart, so it lives here once.
 *
 * The engine is deliberately forgiving about missing recipes: a dish with no
 * `RecipeItem` rows contributes nothing. That is what lets inventory be added
 * to an existing menu without a single data migration, and it means a typo in
 * a recipe can never block a sale at the till.
 */

import type { Prisma } from "../../generated/prisma/client";

/** The subset of the Prisma client this engine needs. */
type Tx = Prisma.TransactionClient;

type OrderLine = { menuItemId: string; quantity: number };

export type StockShortfall = {
  ingredientId: string;
  ingredientName: string;
  required: number;
  available: number;
  unit: string;
};

const round3 = (n: number) => Number(n.toFixed(3));

/**
 * Work out how much of each ingredient a set of order lines consumes.
 *
 * Dishes sharing an ingredient are summed here rather than updated one at a
 * time, so ordering three pastas that all use garlic writes garlic once
 * instead of three times — fewer round trips and no chance of a partial write.
 */
async function requiredByIngredient(tx: Tx, lines: OrderLine[]) {
  const perDish = await tx.recipeItem.findMany({
    where: { menuItemId: { in: lines.map((l) => l.menuItemId) } },
    select: {
      menuItemId: true,
      quantity: true,
      ingredient: { select: { id: true, name: true, unit: true } },
    },
  });

  if (perDish.length === 0) return [];

  const quantityOf = new Map<string, number>();
  for (const line of lines) {
    quantityOf.set(
      line.menuItemId,
      (quantityOf.get(line.menuItemId) ?? 0) + line.quantity,
    );
  }

  const totals = new Map<
    string,
    { ingredientId: string; ingredientName: string; unit: string; amount: number }
  >();

  for (const row of perDish) {
    const dishCount = quantityOf.get(row.menuItemId) ?? 0;
    if (dishCount <= 0) continue;

    const existing = totals.get(row.ingredient.id);
    const amount = round3(row.quantity * dishCount);

    if (existing) {
      existing.amount = round3(existing.amount + amount);
    } else {
      totals.set(row.ingredient.id, {
        ingredientId: row.ingredient.id,
        ingredientName: row.ingredient.name,
        unit: row.ingredient.unit,
        amount,
      });
    }
  }

  return [...totals.values()];
}

/**
 * What an order did to the store.
 *
 * `movementCount` is what lets the caller tell "stock moved" from "this dish
 * has no recipe yet" — the socket broadcast has to fire on the former and stay
 * quiet on the latter, or a till that sells untracked dishes refreshes every
 * kitchen screen for no reason.
 */
export type StockResult = {
  shortfalls: StockShortfall[];
  movementCount: number;
};

/**
 * Deduct the ingredients an order consumes and append a movement per line.
 *
 * Must be called inside the caller's transaction so the order and its stock
 * movement commit together.
 */
export async function consumeStock(
  tx: Tx,
  lines: OrderLine[],
  orderId: string,
): Promise<StockResult> {
  const required = await requiredByIngredient(tx, lines);
  if (required.length === 0) return { shortfalls: [], movementCount: 0 };

  const onHand = await tx.ingredient.findMany({
    where: { id: { in: required.map((r) => r.ingredientId) } },
    select: { id: true, name: true, unit: true, quantity: true },
  });

  const byId = new Map(onHand.map((i) => [i.id, i]));
  const shortfalls: StockShortfall[] = [];
  const writes: Prisma.StockMovementCreateManyInput[] = [];

  for (const need of required) {
    const ingredient = byId.get(need.ingredientId);
    if (!ingredient) continue;

    if (ingredient.quantity < need.amount) {
      shortfalls.push({
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        required: need.amount,
        available: ingredient.quantity,
        unit: ingredient.unit,
      });
    }

    writes.push({
      ingredientId: ingredient.id,
      delta: -need.amount,
      reason: "ORDER",
      orderId,
      note: `Order ${orderId.slice(-6)}`,
    });
  }

  if (writes.length === 0) return { shortfalls: [], movementCount: 0 };

  for (const need of required) {
    const ingredient = byId.get(need.ingredientId);
    if (!ingredient) continue;
    // `decrement`, not a read-modify-write.
    //
    // An earlier version computed `max(0, quantity - need.amount)` in Node and
    // wrote the result. Two tills selling the same ingredient in the same
    // instant both read the same starting balance and both wrote the same
    // result, so one deduction vanished — and the ledger still recorded both,
    // meaning a later void would hand back stock that was never actually taken
    // out. `decrement` is atomic in MongoDB, so the ledger and the balance
    // cannot drift apart.
    //
    // The zero clamp is deliberately gone: with a relative decrement a balance
    // can go slightly negative, which is the truthful signal that the shop sold
    // more than it counted. The `StockShortfall` return is what tells the caller
    // to warn the kitchen, and hiding the overshoot behind a clamp would hide it
    // from everyone.
    await tx.ingredient.update({
      where: { id: ingredient.id },
      data: { quantity: { decrement: need.amount } },
    });
  }

  await tx.stockMovement.createMany({ data: writes });

  return { shortfalls, movementCount: writes.length };
}

/**
 * Put an order's ingredients back after a void.
 *
 * Reads the recorded `ORDER` movements rather than re-deriving them from the
 * order's lines, for two reasons: the recipe may have been edited between the
 * sale and the void (restocking today's prices would be wrong), and a dish that
 * never had a recipe produces no movements, so there is nothing to undo.
 *
 * `reason: "ADJUSTMENT"` rather than a second `ORDER` reason — a void is not a
 * sale, and a report that counts ORDER movements must not count the reversal.
 */
export async function restoreStockForOrder(
  tx: Tx,
  orderId: string,
): Promise<number> {
  const movements = await tx.stockMovement.findMany({
    where: { orderId, reason: "ORDER" },
    select: { ingredientId: true, delta: true },
  });

  if (movements.length === 0) return 0;

  // Idempotence guard.
  //
  // The caller only restores on the WAITING -> CANCELLED edge, which stops a
  // double-click from crediting twice. It does NOT stop the longer path: an
  // order voided, moved back to SERVED, then voided again looks like a fresh
  // transition and would restore a second time. So the reversal is checked
  // directly — an ingredient already credited by an ADJUSTMENT for this order
  // is skipped. Cheap, and it makes the void safe to retry indefinitely.
  const alreadyReversed = new Set(
    (
      await tx.stockMovement.findMany({
        where: { orderId, reason: "ADJUSTMENT" },
        select: { ingredientId: true },
      })
    ).map((m) => m.ingredientId),
  );

  const totals = new Map<string, number>();
  for (const m of movements) {
    if (alreadyReversed.has(m.ingredientId)) continue;
    totals.set(m.ingredientId, (totals.get(m.ingredientId) ?? 0) + m.delta);
  }

  for (const [ingredientId, delta] of totals) {
    const ingredient = await tx.ingredient.findUnique({
      where: { id: ingredientId },
      select: { id: true },
    });
    if (!ingredient) continue;

    // `increment` for the same atomicity reason as `decrement` above.
    await tx.ingredient.update({
      where: { id: ingredientId },
      data: { quantity: { increment: Math.abs(delta) } },
    });

    await tx.stockMovement.create({
      data: {
        ingredientId,
        delta: Math.abs(delta),
        reason: "ADJUSTMENT",
        orderId,
        note: `Order ${orderId.slice(-6)} voided`,
      },
    });
  }

  return totals.size;
}

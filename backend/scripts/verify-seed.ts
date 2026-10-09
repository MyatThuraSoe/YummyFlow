/**
 * Verifies the mock data written by scripts/seed.ts.
 *
 * Checks the claims that only fail at runtime: that seeded credentials
 * actually authenticate through better-auth, that no foreign key dangles
 * (MongoDB enforces none, so a bad id surfaces as a 500 on one screen), that
 * money reconciles against line items, and that every enum state a UI filters
 * on is represented.
 *
 * Runs against the database in DATABASE_URL — no server required:
 *   cd backend && npx tsx scripts/seed.ts
 *   cd backend && npx tsx scripts/verify-seed.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { verifyPassword, hashPassword } from "better-auth/crypto";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// 1. The seeded hash round-trips through better-auth's own verifier.
//    This is the claim that decides whether anyone can sign in at all:
//    a hash produced by `hashPassword` that `verifyPassword` rejects would
//    look fine in the database and fail silently at the login form.
const hash = await hashPassword("Password123!");
check(
  "hashPassword -> verifyPassword round-trip",
  await verifyPassword({ hash, password: "Password123!" }),
);
check(
  "wrong password rejected",
  !(await verifyPassword({ hash, password: "wrong" })),
);

// 2. The hash stored on each seeded Account verifies — i.e. what is actually
//    in the database, not what the script computed in memory.
const accounts = await prisma.account.findMany({
  where: { providerId: "credential", user: { email: { endsWith: "@dineflow.test" } } },
  include: { user: { select: { email: true, role: true } } },
});
check("five credential accounts exist", accounts.length === 5, `got ${accounts.length}`);

for (const account of accounts) {
  const ok =
    !!account.password &&
    (await verifyPassword({ hash: account.password, password: "Password123!" }));
  check(`sign-in works: ${account.user.email} (${account.user.role})`, ok);
}

// 3. Referential integrity — MongoDB enforces no foreign keys, so a dangling
//    id surfaces only as a 500 on the one screen that joins it.
//
//    Checked against the scalar FK columns rather than relation filters: each
//    child stores the parent's id directly, so "parent id not among the real
//    parents" is the whole definition of an orphan, and it needs no nested
//    where shape to express.
const [orderIds, tableIds, menuItemIds, ingredientIds] = await Promise.all([
  prisma.order.findMany({ select: { id: true } }).then((r) => r.map((x) => x.id)),
  prisma.table.findMany({ select: { id: true } }).then((r) => r.map((x) => x.id)),
  prisma.menuItem.findMany({ select: { id: true } }).then((r) => r.map((x) => x.id)),
  prisma.ingredient.findMany({ select: { id: true } }).then((r) => r.map((x) => x.id)),
]);

const orphanOrderItems = await prisma.orderItem.findMany({
  where: { orderId: { notIn: orderIds } },
  select: { id: true },
});
const orphanReservations = await prisma.reservation.findMany({
  where: { tableId: { notIn: tableIds } },
  select: { id: true },
});
const orphanFeedback = await prisma.feedback.findMany({
  where: { menuItemId: { notIn: menuItemIds } },
  select: { id: true },
});
const orphanRecipes = await prisma.recipeItem.findMany({
  where: { OR: [{ menuItemId: { notIn: menuItemIds } }, { ingredientId: { notIn: ingredientIds } }] },
  select: { id: true },
});

check("no orphan order items", orphanOrderItems.length === 0, `${orphanOrderItems.length}`);
check("no orphan reservations", orphanReservations.length === 0, `${orphanReservations.length}`);
check("no orphan feedback", orphanFeedback.length === 0, `${orphanFeedback.length}`);
check("no orphan recipes", orphanRecipes.length === 0, `${orphanRecipes.length}`);

// 4. Orders without a table are the TAKEAWAY/DELIVERY rows. If a DINE_IN
//    order lacked one, the floor plan would silently drop it.
const dineInWithoutTable = await prisma.order.count({
  where: { orderType: "DINE_IN", tableId: null },
});
check("every DINE_IN order has a table", dineInWithoutTable === 0, `${dineInWithoutTable}`);

// 5. The dashboard buckets by hour, so orders must span more than one hour.
const orders = await prisma.order.findMany({
  select: { createdAt: true, status: true, paymentStatus: true },
});
const hours = new Set(
  orders.map((o) => `${o.createdAt.toDateString()} ${o.createdAt.getHours()}`),
);
check("orders span multiple day/hour buckets", hours.size >= 5, `${hours.size} buckets`);

const statuses = new Set(orders.map((o) => o.status));
check("all five OrderStatus values present", statuses.size === 5, [...statuses].join(","));

const payStatuses = new Set(orders.map((o) => o.paymentStatus));
check("paid + pending payment states present", payStatuses.size >= 2, [...payStatuses].join(","));

// 6. Money: totalAmount must equal the sum of its line items at snapshot price.
const pricedOrders = await prisma.order.findMany({
  include: { items: { select: { price: true, quantity: true } } },
});
const mismatches = pricedOrders.filter((o) => {
  const sum = o.items.reduce((acc, i) => acc + i.price * i.quantity, 0);
  return Math.abs(sum - o.totalAmount) > 0.001;
});
check(
  "order.totalAmount matches sum of line items",
  mismatches.length === 0,
  `${mismatches.length} mismatched`,
);

// 7. PortableText description must be an array of blocks — a plain string
//    would render as an empty description on the menu.
const items = await prisma.menuItem.findMany({ select: { name: true, description: true } });
const notBlocks = items.filter(
  (i) => !Array.isArray(i.description) || (i.description as unknown[]).length === 0,
);
check("every menu item has a PortableText block", notBlocks.length === 0,
  notBlocks.map((i) => i.name).join(",") || "all good");

// 8. At least one menu item must be unavailable, or the disabled state is
//    untestable from the UI.
const unavailable = await prisma.menuItem.count({ where: { isAvailable: false } });
check("an unavailable menu item exists", unavailable >= 1, `${unavailable}`);

// 9. Low-stock flag needs ingredients at or below reorderAt.
const lowStock = await prisma.ingredient.count({
  where: { quantity: { lte: prisma.ingredient.fields.reorderAt } },
});
check("low-stock ingredients exist", lowStock >= 1, `${lowStock}`);

// 10. The notification delivery log must contain a failure row, otherwise the
//     error state of that panel is never exercised.
const failedNotifications = await prisma.notificationLog.count({
  where: { status: "FAILED" },
});
check("a FAILED notification row exists", failedNotifications >= 1, `${failedNotifications}`);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
await prisma.$disconnect();
if (failures > 0) process.exitCode = 1;

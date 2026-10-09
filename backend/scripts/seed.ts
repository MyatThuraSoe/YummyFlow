/**
 * Mock-data seeder.
 *
 * Writes 5 rows for every feature so the product can be exercised by hand:
 * menu, tables, bookings, queue, orders, inventory, reviews, audit trail,
 * notification history and cached briefings.
 *
 * Why a script rather than hitting the API: it uses the same Prisma client the
 * app reads from, so what lands in the database is exactly the shape the app
 * expects — which is the thing worth testing. Seeding over HTTP would test the
 * HTTP layer instead.
 *
 * SAFETY — `--reset` wipes first. Without it the script refuses to run if it
 * has already seeded this database (detects its own `@dineflow.test` users and
 * menu items), because no row carries a test-data marker and a blind wipe could
 * not be undone. A database holding *other* data is fine to seed alongside.
 *
 *   npx tsx scripts/seed.ts           # seeds an empty database
 *   npx tsx scripts/seed.ts --reset   # wipes, then seeds
 *
 * ID HANDLING — models declared `@db.ObjectId` get their id from Prisma's
 * `@default(auto())`. Handing those a string like "seed_menu_1" is not a valid
 * 24-hex ObjectId and is rejected. Only User/Account take explicit ids: those
 * are plain strings (Better Auth writes 32-hex there), so they are set here to
 * keep sign-in credentials stable across runs.
 */
import "dotenv/config";
import crypto from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../src/lib/prisma";
import type {
  BookingStatus,
  BriefingKind,
  NotificationChannel,
  NotificationStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  Role,
  TableStatus,
  TableType,
  WaitlistStatus,
} from "../generated/prisma/enums";

const RESET = process.argv.includes("--reset");

const log = (msg: string) => console.log(msg);

/** Indexing a tuple under `noUncheckedIndexedAccess` yields `T | undefined`. */
function at<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`${label}: no entry at index ${index}`);
  }
  return item;
}

/** PortableText block — `description` is `Json?` but rendered as rich text. */
const block = (text: string, key: string) => ({
  _type: "block",
  _key: key,
  style: "normal",
  markDefs: [],
  children: [{ _type: "span", _key: `${key}-s`, text, marks: [] }],
});

const blocks = (text: string, key: string) => [block(text, key)];

/**
 * Stable 32-hex id for Better Auth's own models. `User.id` is a plain String,
 * so unlike the ObjectId models this accepts a value we choose — deriving it
 * from the email keeps `admin@dineflow.test` at the same id every run.
 */
const authId = (seed: string) =>
  crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);

/* ──────────────────────────────────────────────────────────────────────────
 * Each function returns what it created so the next can reference real ids.
 * Prisma auto-generates ObjectIds, so ids cannot be known before the write.
 * ────────────────────────────────────────────────────────────────────────── */

type SeedUser = { id: string; name: string; email: string; role: Role };

const seedUsers = async (): Promise<SeedUser[]> => {
  // One per Role: every staff page is role-gated, so each gate gets a login.
  const rows: (SeedUser & { phone: string })[] = [
    { id: authId("admin"), name: "Amara Okafor", email: "admin@dineflow.test", role: "ADMIN", phone: "+254700000001" },
    { id: authId("manager"), name: "Daniel Mwangi", email: "manager@dineflow.test", role: "MANAGER", phone: "+254700000002" },
    { id: authId("waiter"), name: "Grace Njeri", email: "waiter@dineflow.test", role: "STAFF", phone: "+254700000003" },
    { id: authId("chef"), name: "Somchai Prasert", email: "chef@dineflow.test", role: "KITCHEN", phone: "+254700000004" },
    { id: authId("diner"), name: "Aye Chan Mya", email: "diner@dineflow.test", role: "CUSTOMER", phone: "+254700000005" },
  ];

  const password = await hashPassword("Password123!");

  for (const row of rows) {
    await prisma.user.upsert({
      where: { id: row.id },
      update: { role: row.role, name: row.name },
      create: {
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: true,
        role: row.role,
        phone: row.phone,
        status: "active",
      },
    });

    // The Account row is what makes the login work. A User with no credential
    // account authenticates as nothing — the password hash lives here.
    const accountId = `cred-${row.id}`;
    await prisma.account.upsert({
      where: { id: accountId },
      update: { password },
      create: {
        id: accountId,
        accountId: row.id,
        providerId: "credential",
        password,
        userId: row.id,
      },
    });
  }

  return rows;
};

const seedCategories = async () => {
  const rows = [
    { name: "Starters", slug: "starters" },
    { name: "Mains", slug: "mains" },
    { name: "Grill", slug: "grill" },
    { name: "Desserts", slug: "desserts" },
    { name: "Drinks", slug: "drinks" },
  ];

  const created: { id: string; name: string }[] = [];
  for (const row of rows) {
    // `slug` and `name` are both @unique, so upsert on the slug.
    const record = await prisma.category.upsert({
      where: { slug: row.slug },
      update: { name: row.name },
      create: { name: row.name, slug: row.slug },
    });
    created.push(record);
  }
  return created;
};

const seedMenuItems = async (categories: { id: string; name: string }[]) => {
  const rows = [
    { name: "Samosa Trio", price: 4.5, discount: 0, category: "Starters", desc: "Crisp pastry parcels with spiced potato, served with tamarind chutney." },
    { name: "Nyama Choma", price: 12.0, discount: 1.0, category: "Grill", desc: "Charcoal-grilled goat, kachumbari and ugali on the side." },
    { name: "Coconut Fish Curry", price: 14.5, discount: 0, category: "Mains", desc: "Line-caught fish simmered in coconut milk with curry leaf and lime." },
    { name: "Mango Sticky Rice", price: 6.0, discount: 0, category: "Desserts", desc: "Warm glutinous rice, ripe mango and a coconut cream pour." },
    { name: "Fresh Lime Soda", price: 3.0, discount: 0, category: "Drinks", desc: "Pressed lime, soda and a little sugar over crushed ice." },
  ];

  const created: { id: string; name: string; price: number; discount: number | null }[] = [];
  for (const row of rows) {
    const category = categories.find((c) => c.name === row.category);
    if (!category) throw new Error(`seedMenuItems: category ${row.category} not found`);

    const record = await prisma.menuItem.create({
      data: {
        name: row.name,
        price: row.price,
        discount: row.discount,
        categoryId: category.id,
        // One dish unavailable so the disabled/menu-off state is visible.
        isAvailable: row.name !== "Fresh Lime Soda",
        description: blocks(row.desc, `desc-${row.name}`),
      },
    });
    created.push(record);
  }
  return created;
};

const seedTables = async () => {
  const rows: { name: string; seats: number; section: string; shape: TableType; status: TableStatus }[] = [
    { name: "01", seats: 2, section: "Main Dining Room", shape: "square", status: "AVAILABLE" },
    { name: "02", seats: 4, section: "Main Dining Room", shape: "square", status: "OCCUPIED" },
    { name: "03", seats: 6, section: "Terrace", shape: "rectangle", status: "RESERVED" },
    { name: "04", seats: 8, section: "Terrace", shape: "rectangle", status: "CLEANING" },
    { name: "VIP 1", seats: 10, section: "Private Room", shape: "circle", status: "AVAILABLE" },
  ];

  const created: { id: string; name: string }[] = [];
  for (const row of rows) {
    // `name` is @unique — the host desk identifies tables by name.
    const record = await prisma.table.upsert({
      where: { name: row.name },
      update: { status: row.status },
      create: row,
    });
    created.push(record);
  }
  return created;
};

const seedIngredients = async () => {
  const rows = [
    { name: "Basmati Rice", unit: "kg", quantity: 40, reorderAt: 10, costPerUnit: 1.2 },
    { name: "Chicken Thighs", unit: "kg", quantity: 6, reorderAt: 8, costPerUnit: 3.5 },
    { name: "Coconut Milk", unit: "tin", quantity: 24, reorderAt: 6, costPerUnit: 0.9 },
    { name: "Mangoes", unit: "kg", quantity: 12, reorderAt: 4, costPerUnit: 2.1 },
    { name: "Limes", unit: "kg", quantity: 1.5, reorderAt: 3, costPerUnit: 0.8 },
  ];

  const created: { id: string; name: string }[] = [];
  for (const row of rows) {
    // `name` is @unique. Two ingredients sit at or below `reorderAt` so the
    // low-stock flag has something real to report.
    const record = await prisma.ingredient.upsert({
      where: { name: row.name },
      update: { quantity: row.quantity },
      create: row,
    });
    created.push(record);
  }
  return created;
};

const seedRecipes = async (
  items: { id: string; name: string }[],
  ingredients: { id: string; name: string }[],
) => {
  // Pairs dish -> (ingredient, amount per serving, in that ingredient's unit).
  const pairs: { dish: string; ingredient: string; quantity: number }[] = [
    { dish: "Coconut Fish Curry", ingredient: "Basmati Rice", quantity: 0.25 },
    { dish: "Coconut Fish Curry", ingredient: "Coconut Milk", quantity: 0.5 },
    { dish: "Mango Sticky Rice", ingredient: "Mangoes", quantity: 0.4 },
    { dish: "Fresh Lime Soda", ingredient: "Limes", quantity: 0.1 },
  ];

  for (const pair of pairs) {
    const item = items.find((i) => i.name === pair.dish);
    const ingredient = ingredients.find((i) => i.name === pair.ingredient);
    if (!item) throw new Error(`seedRecipes: dish ${pair.dish} not found`);
    if (!ingredient) throw new Error(`seedRecipes: ingredient ${pair.ingredient} not found`);

    // @@unique([menuItemId, ingredientId]) — the supported upsert key.
    await prisma.recipeItem.upsert({
      where: { menuItemId_ingredientId: { menuItemId: item.id, ingredientId: ingredient.id } },
      update: { quantity: pair.quantity },
      create: { menuItemId: item.id, ingredientId: ingredient.id, quantity: pair.quantity },
    });
  }

  // Deliberately leaves dishes without a recipe. A dish with no rows here has
  // no recipe, so ordering it must not touch stock — worth seeing for real
  // rather than trusting the comment on `menuItem.recipeItems`.
  return pairs;
};

const seedStock = async (ingredients: { id: string; name: string }[]) => {
  const rows: { ingredient: string; delta: number; reason: string; note: string; daysAgo: number }[] = [
    { ingredient: "Basmati Rice", delta: 25, reason: "RESTOCK", note: "Delivery from Rift Valley Mills", daysAgo: 4 },
    { ingredient: "Chicken Thighs", delta: -3, reason: "WASTE", note: "Missed the service window", daysAgo: 3 },
    { ingredient: "Coconut Milk", delta: 12, reason: "RESTOCK", note: "Coastal Imports drop", daysAgo: 2 },
    { ingredient: "Mangoes", delta: -1.5, reason: "WASTE", note: "Over-ripe, pulled from the pass", daysAgo: 1 },
    // ADJUSTMENT with no order behind it: the count disagreed with the ledger.
    { ingredient: "Limes", delta: 0.5, reason: "ADJUSTMENT", note: "Physical count reconciliation", daysAgo: 0 },
  ];

  for (const row of rows) {
    const ingredient = ingredients.find((i) => i.name === row.ingredient);
    if (!ingredient) throw new Error(`seedStock: ingredient ${row.ingredient} not found`);

    await prisma.stockMovement.create({
      data: {
        ingredientId: ingredient.id,
        delta: row.delta,
        reason: row.reason,
        note: row.note,
        createdAt: new Date(Date.now() - row.daysAgo * 86_400_000),
      },
    });
  }
};

const seedReservations = async (tables: { id: string; name: string }[], users: SeedUser[]) => {
  const rows: {
    customerName: string | null;
    email: string | null;
    user: number | null;
    table: string;
    hoursFromNow: number;
    guests: number;
    status: BookingStatus;
  }[] = [
    { customerName: "Aye Chan Mya", email: "guest1@dineflow.test", user: 4, table: "01", hoursFromNow: 2, guests: 2, status: "PENDING" },
    { customerName: "Daniel Mwangi", email: "guest2@dineflow.test", user: 1, table: "02", hoursFromNow: 4, guests: 4, status: "CONFIRMED" },
    { customerName: "Grace Njeri", email: "guest3@dineflow.test", user: 2, table: "03", hoursFromNow: 26, guests: 6, status: "CANCELLED" },
    // No account behind this one: guest booking, name + email only.
    { customerName: "Walk-in Party", email: null, user: null, table: "04", hoursFromNow: 30, guests: 3, status: "PENDING" },
    { customerName: "Somchai Prasert", email: "guest5@dineflow.test", user: 3, table: "VIP 1", hoursFromNow: 50, guests: 8, status: "COMPLETED" },
  ];

  for (const row of rows) {
    const table = tables.find((t) => t.name === row.table);
    if (!table) throw new Error(`seedReservations: table ${row.table} not found`);

    await prisma.reservation.create({
      data: {
        customerName: row.customerName,
        email: row.email,
        userId: row.user === null ? null : at(users, row.user, "seedReservations.user").id,
        tableId: table.id,
        date: new Date(Date.now() + row.hoursFromNow * 3_600_000),
        guests: row.guests,
        status: row.status,
      },
    });
  }
};

const seedWaitlist = async (tables: { id: string; name: string }[]) => {
  const rows: {
    customerName: string;
    phone: string;
    guests: number;
    status: WaitlistStatus;
    table: string | null;
    minutesAgo: number;
    notes: string | null;
  }[] = [
    { customerName: "Walk-in One", phone: "+254700000011", guests: 2, status: "WAITING", table: null, minutesAgo: 30, notes: "Needs a high chair" },
    { customerName: "Walk-in Two", phone: "+254700000012", guests: 1, status: "SEATED", table: "02", minutesAgo: 25, notes: null },
    { customerName: "Walk-in Three", phone: "+254700000013", guests: 4, status: "WAITING", table: null, minutesAgo: 18, notes: "Prefers the terrace" },
    { customerName: "Walk-in Four", phone: "+254700000014", guests: 3, status: "NO_SHOW", table: null, minutesAgo: 12, notes: null },
    { customerName: "Walk-in Five", phone: "+254700000015", guests: 5, status: "CANCELLED", table: null, minutesAgo: 5, notes: "Party left before seating" },
  ];

  for (const row of rows) {
    const table = row.table ? tables.find((t) => t.name === row.table) : null;
    if (row.table && !table) throw new Error(`seedWaitlist: table ${row.table} not found`);

    await prisma.waitlist.create({
      data: {
        customerName: row.customerName,
        phone: row.phone,
        guests: row.guests,
        status: row.status,
        // Only the seated row carries a table; the rest are still in the queue.
        tableId: table?.id ?? null,
        seatedAt: row.status === "SEATED" ? new Date(Date.now() - row.minutesAgo * 60_000) : null,
        notes: row.notes,
        createdAt: new Date(Date.now() - row.minutesAgo * 60_000),
      },
    });
  }
};

const seedOrders = async (
  items: { id: string; name: string; price: number; discount: number | null }[],
  tables: { id: string; name: string }[],
  users: SeedUser[],
) => {
  const rows: {
    orderType: OrderType;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    paymentMethod: PaymentMethod;
    table: string | null;
    user: number | null;
    quantity: number;
    daysAgo: number;
    hour: number;
    minute: number;
    notes: string | null;
  }[] = [
    { orderType: "DINE_IN", status: "PENDING", paymentStatus: "PENDING", paymentMethod: "CASH", table: "01", user: 4, quantity: 2, daysAgo: 4, hour: 11, minute: 5, notes: "No onions" },
    { orderType: "DINE_IN", status: "PREPARING", paymentStatus: "PAID", paymentMethod: "CASH", table: "02", user: null, quantity: 1, daysAgo: 3, hour: 13, minute: 22, notes: null },
    { orderType: "TAKEAWAY", status: "READY", paymentStatus: "PAID", paymentMethod: "CASH", table: null, user: 2, quantity: 3, daysAgo: 2, hour: 19, minute: 5, notes: null },
    { orderType: "DELIVERY", status: "SERVED", paymentStatus: "PAID", paymentMethod: "CASH", table: null, user: null, quantity: 2, daysAgo: 1, hour: 20, minute: 40, notes: "Leave at the gate" },
    { orderType: "DINE_IN", status: "CANCELLED", paymentStatus: "PENDING", paymentMethod: "CASH", table: "VIP 1", user: 1, quantity: 4, daysAgo: 0, hour: 12, minute: 0, notes: null },
  ];

  // One distinct dish per order status, so the Kitchen Display shows every
  // column populated rather than five copies of the same line.
  const itemsByStatus = [
    "Samosa Trio",
    "Nyama Choma",
    "Coconut Fish Curry",
    "Mango Sticky Rice",
    "Fresh Lime Soda",
  ] as const;

  for (const [index, row] of rows.entries()) {
    const item = items.find((i) => i.name === at(itemsByStatus, index, "seedOrders.item"));
    if (!item) throw new Error(`seedOrders: menu item not found at ${index}`);

    const table = row.table ? tables.find((t) => t.name === row.table) : null;
    if (row.table && !table) throw new Error(`seedOrders: table ${row.table} not found`);

    // Spread across 5 days AND across the clock. The dashboard, heatmap and
    // day-close bucket by hour and by day, so seeding every order at "now"
    // would render a single spike and prove nothing.
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - row.daysAgo);
    createdAt.setHours(row.hour, row.minute, 0, 0);

    // Matches the app's own arithmetic in controllers/order.ts:178 —
    // `totalAmount` is sum(price * qty) with the discount NOT subtracted,
    // and OrderItem.price is the undiscounted snapshot. Computing it any
    // other way here would seed orders whose totals disagree with every
    // receipt the app prints, so the discrepancy would look like an app bug.
    const order = await prisma.order.create({
      data: {
        orderType: row.orderType,
        status: row.status,
        paymentStatus: row.paymentStatus,
        paymentMethod: row.paymentMethod,
        totalAmount: item.price * row.quantity,
        userId: row.user === null ? null : at(users, row.user, "seedOrders.user").id,
        // TAKEAWAY and DELIVERY have no table — tableId is nullable for this.
        tableId: table?.id ?? null,
        createdAt,
      },
    });

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        menuItemId: item.id,
        quantity: row.quantity,
        // Snapshot: deliberately not re-read from menuItem later.
        price: item.price,
        notes: row.notes,
      },
    });
  }
};

const seedFeedback = async (items: { id: string; name: string }[], users: SeedUser[]) => {
  const rows: { dish: string; rating: number; comment: string | null; user: number | null; daysAgo: number }[] = [
    { dish: "Samosa Trio", rating: 5, comment: "Best starter on the menu, ordered twice.", user: 4, daysAgo: 4 },
    { dish: "Nyama Choma", rating: 3, comment: "Good flavour but a little too salty.", user: 1, daysAgo: 3 },
    { dish: "Coconut Fish Curry", rating: 4, comment: "Really good portion size.", user: 2, daysAgo: 2 },
    // A guest with no account left this — reviews are not login-gated.
    { dish: "Mango Sticky Rice", rating: 2, comment: "Arrived cold.", user: null, daysAgo: 1 },
    { dish: "Fresh Lime Soda", rating: 5, comment: null, user: null, daysAgo: 0 },
  ];

  for (const row of rows) {
    const item = items.find((i) => i.name === row.dish);
    if (!item) throw new Error(`seedFeedback: dish ${row.dish} not found`);

    await prisma.feedback.create({
      data: {
        rating: row.rating,
        comment: row.comment,
        menuItemId: item.id,
        userId: row.user === null ? null : at(users, row.user, "seedFeedback.user").id,
        createdAt: new Date(Date.now() - row.daysAgo * 86_400_000),
      },
    });
  }
};

const seedActivityLog = async (users: SeedUser[]) => {
  const rows: { user: number; action: string; details: string; hoursAgo: number }[] = [
    { user: 0, action: "CREATE_MENU_ITEM", details: "Menu item created: Samosa Trio", hoursAgo: 6 },
    { user: 1, action: "UPDATE_ORDER", details: "Order moved to PREPARING", hoursAgo: 4 },
    { user: 2, action: "UPDATE_ORDER_PAYMENT", details: "Order marked PAID (CASH)", hoursAgo: 3 },
    { user: 0, action: "UPDATE_USER", details: "User role changed to STAFF", hoursAgo: 2 },
    { user: 1, action: "DELETE_TABLE", details: "Table removed: 07", hoursAgo: 1 },
  ];

  for (const row of rows) {
    await prisma.activitiesLog.create({
      data: {
        userId: at(users, row.user, "seedActivityLog.user").id,
        action: row.action,
        details: row.details,
        createdAt: new Date(Date.now() - row.hoursAgo * 3_600_000),
      },
    });
  }
};

const seedNotificationLog = async (users: SeedUser[]) => {
  const rows: {
    channel: NotificationChannel;
    status: NotificationStatus;
    template: string;
    recipient: string;
    subject: string;
    error: string | null;
    user: number | null;
    hoursAgo: number;
  }[] = [
    { channel: "EMAIL", status: "SENT", template: "reservation-confirmed", recipient: "guest1@dineflow.test", subject: "Your table is confirmed", error: null, user: 4, hoursAgo: 5 },
    { channel: "PUSH", status: "SENT", template: "order-ready", recipient: "push:dineflow.test/1", subject: "Order is ready", error: null, user: 2, hoursAgo: 4 },
    // FAILED with a real-looking reason: the delivery log panel needs to show
    // an error row, not only successes.
    { channel: "EMAIL", status: "FAILED", template: "reservation-confirmed", recipient: "guest3@dineflow.test", subject: "Your table is confirmed", error: "SMTP connection refused", user: 1, hoursAgo: 3 },
    { channel: "PUSH", status: "SKIPPED", template: "order-status", recipient: "push:dineflow.test/2", subject: "Order status changed", error: null, user: null, hoursAgo: 2 },
    { channel: "EMAIL", status: "SENT", template: "reservation-reminder", recipient: "guest5@dineflow.test", subject: "Reminder: your booking is tomorrow", error: null, user: 3, hoursAgo: 1 },
  ];

  for (const row of rows) {
    await prisma.notificationLog.create({
      data: {
        channel: row.channel,
        status: row.status,
        template: row.template,
        recipient: row.recipient,
        subject: row.subject,
        error: row.error,
        userId: row.user === null ? null : at(users, row.user, "seedNotificationLog.user").id,
        createdAt: new Date(Date.now() - row.hoursAgo * 3_600_000),
      },
    });
  }
};

const seedBriefings = async () => {
  const rows: { kind: BriefingKind; headline: string; daysAgo: number; payload: object }[] = [
    {
      kind: "EXECUTIVE",
      headline: "Weekend covers up 12% on last week",
      daysAgo: 6,
      payload: {
        revenue: { current: 4820, previous: 4300 },
        covers: { current: 214, previous: 191 },
        topItems: [{ name: "Nyama Choma", revenue: 1180 }],
      },
    },
    {
      kind: "EXECUTIVE",
      headline: "Grill section carrying the dinner service",
      daysAgo: 5,
      payload: {
        revenue: { current: 3910, previous: 4100 },
        covers: { current: 186, previous: 192 },
        orderMix: [{ name: "Dine In", count: 142 }, { name: "Takeaway", count: 44 }],
      },
    },
    {
      kind: "FORECAST",
      headline: "Forecast: quiet Tuesday, staff down one",
      daysAgo: 4,
      payload: {
        forecastCovers: 64,
        suggestedStaff: 3,
        risk: "low",
      },
    },
    {
      kind: "EXECUTIVE",
      headline: "Two dishes below a 3.5 rating",
      daysAgo: 2,
      payload: {
        revenue: { current: 3120, previous: 3600 },
        lowRated: [{ name: "Mango Sticky Rice", rating: 2 }],
      },
    },
    {
      kind: "FORECAST",
      headline: "Forecast: terrace weather drives covers up",
      daysAgo: 1,
      payload: {
        forecastCovers: 240,
        suggestedStaff: 6,
        risk: "medium",
      },
    },
  ];

  for (const row of rows) {
    const periodStart = new Date(Date.now() - row.daysAgo * 86_400_000);
    const periodEnd = new Date(periodStart.getTime() + 86_400_000);

    await prisma.briefing.create({
      data: {
        kind: row.kind,
        headline: row.headline,
        summary: "Seeded briefing payload so the dashboard cache can be read without waiting on the AI.",
        payload: row.payload,
        model: "seed",
        periodStart,
        periodEnd,
        createdAt: periodEnd,
      },
    });
  }
};

const seedPushSubscriptions = async (users: SeedUser[]) => {
  for (const [index, user] of users.entries()) {
    await prisma.pushSubscription.upsert({
      // `endpoint` is @unique — one row per browser install.
      where: { endpoint: `https://push.dineflow.test/seed/${index + 1}` },
      update: {},
      create: {
        endpoint: `https://push.dineflow.test/seed/${index + 1}`,
        // Placeholder keys: web-push validates shape, not ownership, on read.
        auth: crypto.randomBytes(16).toString("base64url"),
        p256dh: crypto.randomBytes(65).toString("base64url"),
        userAgent: "Seed/1.0",
        userId: user.id,
      },
    });
  }
};

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Parents before children. Mongo enforces no foreign keys, so deleting in the
 * wrong order would leave orphans rather than error — the order has to be
 * right by construction, not because the database complains.
 */
const wipeAll = async () => {
  log("--reset supplied: clearing all data …");
  await prisma.orderItem.deleteMany({});
  await prisma.stockMovement.deleteMany({});
  await prisma.recipeItem.deleteMany({});
  await prisma.feedback.deleteMany({});
  await prisma.reservation.deleteMany({});
  await prisma.waitlist.deleteMany({});
  await prisma.notificationLog.deleteMany({});
  await prisma.briefing.deleteMany({});
  await prisma.pushSubscription.deleteMany({});
  await prisma.activitiesLog.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.menuItem.deleteMany({});
  await prisma.ingredient.deleteMany({});
  await prisma.table.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.user.deleteMany({});
  log("  cleared.");
};

/**
 * Refuses to seed only when the seed has already run — not merely when the
 * database is non-empty.
 *
 * A blanket "any data at all" check would make the one realistic case (an
 * existing account created by hand, like an admin signing up during setup)
 * force `--reset`, whose only effect would be to destroy that account. The
 * marker is the seeded domain: nothing outside this script writes it.
 */
const SEED_EMAIL_DOMAIN = "@dineflow.test";

const refuseIfSeededAlready = async () => {
  const seededUsers = await prisma.user.count({
    where: { email: { endsWith: SEED_EMAIL_DOMAIN } },
  });

  // Menu items are the other half of the marker. This script is the only
  // thing that creates a menu item alongside a `@dineflow.test` user, so
  // either one alone means a previous run — and both are checked because a
  // partial failure could leave one without the other.
  const menuItems = await prisma.menuItem.count();

  if (seededUsers === 0 && menuItems === 0) {
    log("No existing seed data: seeding …");
    return;
  }

  console.error(
    `\nThis database already contains seed data\n` +
      `  ${SEED_EMAIL_DOMAIN} users: ${seededUsers}\n` +
      `  menu items:               ${menuItems}\n` +
      "\nSeeding again would duplicate rows — no row carries a marker that\n" +
      "would let a partial run be replaced in place.\n" +
      "Re-run with --reset to wipe and seed:\n" +
      "  npx tsx scripts/seed.ts --reset\n",
  );
  process.exitCode = 1;
};

async function main() {
  if (RESET) await wipeAll();
  else await refuseIfSeededAlready();
  if (process.exitCode === 1) return;

  const users = await seedUsers();
  const categories = await seedCategories();
  const items = await seedMenuItems(categories);
  const tables = await seedTables();
  const ingredients = await seedIngredients();
  await seedRecipes(items, ingredients);
  await seedStock(ingredients);
  await seedReservations(tables, users);
  await seedWaitlist(tables);
  await seedOrders(items, tables, users);
  await seedFeedback(items, users);
  await seedActivityLog(users);
  await seedNotificationLog(users);
  await seedBriefings();
  await seedPushSubscriptions(users);

  const counts: Record<string, number> = {
    users: await prisma.user.count(),
    accounts: await prisma.account.count(),
    categories: await prisma.category.count(),
    menuItems: await prisma.menuItem.count(),
    tables: await prisma.table.count(),
    ingredients: await prisma.ingredient.count(),
    recipes: await prisma.recipeItem.count(),
    stockMovements: await prisma.stockMovement.count(),
    reservations: await prisma.reservation.count(),
    waitlist: await prisma.waitlist.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    feedback: await prisma.feedback.count(),
    activitiesLog: await prisma.activitiesLog.count(),
    notificationLog: await prisma.notificationLog.count(),
    briefings: await prisma.briefing.count(),
    pushSubscriptions: await prisma.pushSubscription.count(),
  };

  log("");
  for (const [name, count] of Object.entries(counts)) {
    log(`  ${name.padEnd(20)} ${count}`);
  }
  log("");
  log("Sign-in accounts (password for all: Password123!):");
  for (const user of users) {
    log(`  ${user.email.padEnd(28)} ${user.role}`);
  }
  log("");
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

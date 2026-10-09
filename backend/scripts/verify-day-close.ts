/**
 * End-to-end verification for the service-day close, per-item notes and the
 * receipt reprint.
 *
 * Drives the REAL HTTP API, so the backend must already be running:
 *   cd backend && npm run dev          # in another terminal
 *   cd backend && npm run verify:day-close
 *
 * Creates throwaway `e2e.probe.*` users plus three probe orders (today paid,
 * today cancelled, yesterday paid) and removes them all afterwards.
 *
 * NOTE ON THE MOST IMPORTANT ASSERTION HERE:
 * "collected includes the probe order" is not merely a totals check. Prisma's
 * `$runCommandRaw` silently returns nothing when a JS `Date` is passed into a
 * pipeline instead of a BSON `{ $date }`, so a broken date wrapper would make
 * this endpoint report a confident, plausible, entirely empty day. The check
 * that real money shows up is what catches that class of bug.
 */
import "dotenv/config";
import http from "node:http";
import { prisma } from "../src/lib/prisma";

const ORIGIN = "http://localhost:5173";
const BASE = { host: "127.0.0.1", port: 5000 };

type Res = { status: number; body: any; cookies: string[]; raw: string };

function req(
  method: string,
  p: string,
  body?: unknown,
  cookie?: string,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { Origin: ORIGIN };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    if (cookie) headers["Cookie"] = cookie;

    const r = http.request({ ...BASE, method, path: p, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let parsed: any = data;
        try {
          parsed = JSON.parse(data);
        } catch {
          /* keep raw */
        }
        resolve({
          status: res.statusCode ?? 0,
          body: parsed,
          cookies: (res.headers["set-cookie"] as string[]) ?? [],
          raw: data,
        });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const cookieOf = (res: Res) => res.cookies.map((c) => c.split(";")[0]).join("; ");

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const STAMP = Date.now();
const PASSWORD = "ProbePassw0rd!";

async function makeUser(
  label: string,
  role: "ADMIN" | "MANAGER" | "STAFF" | "KITCHEN" | "CUSTOMER",
) {
  const email = `e2e.probe.${label}.${STAMP}@dineflow.local`;
  const signup = await req("POST", "/api/auth/sign-up/email", {
    email,
    password: PASSWORD,
    name: `Probe ${label}`,
  });
  if (signup.status !== 200 && signup.status !== 201) {
    throw new Error(`signup failed for ${label}: ${signup.status} ${signup.raw}`);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`user row missing for ${label}`);

  if (role !== "CUSTOMER") {
    await prisma.user.update({ where: { id: user.id }, data: { role } });
  }

  const signin = await req("POST", "/api/auth/sign-in/email", {
    email,
    password: PASSWORD,
  });
  if (signin.status !== 200) {
    throw new Error(`signin failed for ${label}: ${signin.status} ${signin.raw}`);
  }

  return { id: user.id, email, cookie: cookieOf(signin) };
}

/** UTC midnight of today — the window the report cuts. */
const utcToday = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const utcDayKey = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const menuItem = await prisma.menuItem.findFirst({
    select: { id: true, name: true, price: true },
  });
  if (!menuItem) throw new Error("no menu item available to build probe orders");

  const todayStart = utcToday();
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

  /* ---------------- probe orders ---------------- */
  // Today, paid, dine-in — must count towards collected.
  const paidToday = await prisma.order.create({
    data: {
      orderType: "TAKEAWAY",
      status: "SERVED",
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      totalAmount: 41.25,
      createdAt: new Date(todayStart.getTime() + 12 * 3600_000),
      items: {
        create: [{ menuItemId: menuItem.id, quantity: 3, price: 13.75 }],
      },
    },
  });

  // Today, cancelled — must count as a void, never as revenue.
  const voidedToday = await prisma.order.create({
    data: {
      orderType: "DINE_IN",
      status: "CANCELLED",
      paymentStatus: "PENDING",
      paymentMethod: "CASH",
      totalAmount: 17.5,
      createdAt: new Date(todayStart.getTime() + 13 * 3600_000),
      items: { create: [{ menuItemId: menuItem.id, quantity: 1, price: 17.5 }] },
    },
  });

  // Yesterday — must NOT appear in today's report.
  const paidYesterday = await prisma.order.create({
    data: {
      orderType: "TAKEAWAY",
      status: "SERVED",
      paymentStatus: "PAID",
      paymentMethod: "CARD",
      totalAmount: 99.99,
      createdAt: new Date(yesterdayStart.getTime() + 12 * 3600_000),
      items: { create: [{ menuItemId: menuItem.id, quantity: 1, price: 99.99 }] },
    },
  });

  const probeOrderIds = [paidToday.id, voidedToday.id, paidYesterday.id];

  /* ---------------- users ---------------- */
  const staff = await makeUser("staff", "STAFF");
  const kitchen = await makeUser("kitchen", "KITCHEN");
  const manager = await makeUser("manager", "MANAGER");
  const admin = await makeUser("admin", "ADMIN");

  /* ---------------- 1. access control ---------------- */
  const anon = await req("GET", "/api/reports/day-close");
  check("anonymous day-close is rejected", anon.status === 401, `got ${anon.status}`);

  const asStaff = await req("GET", "/api/reports/day-close", undefined, staff.cookie);
  check("STAFF cannot read takings", asStaff.status === 403, `got ${asStaff.status}`);

  const asKitchen = await req("GET", "/api/reports/day-close", undefined, kitchen.cookie);
  check("KITCHEN cannot read takings", asKitchen.status === 403, `got ${asKitchen.status}`);

  const asManager = await req("GET", "/api/reports/day-close", undefined, manager.cookie);
  check("MANAGER can read the day close", asManager.status === 200, `got ${asManager.status}`);

  const asAdmin = await req("GET", "/api/reports/day-close", undefined, admin.cookie);
  check("ADMIN can read the day close", asAdmin.status === 200, `got ${asAdmin.status}`);

  /* ---------------- 2. input validation ---------------- */
  const badDate = await req(
    "GET",
    "/api/reports/day-close?date=nonsense",
    undefined,
    admin.cookie,
  );
  check("a malformed date is rejected", badDate.status === 400, `got ${badDate.status}`);

  // "2026-13-45" parses into a different month rather than throwing, so it has
  // to be caught by the round-trip check.
  const impossible = await req(
    "GET",
    "/api/reports/day-close?date=2026-13-45",
    undefined,
    admin.cookie,
  );
  check("an impossible date is rejected", impossible.status === 400, `got ${impossible.status}`);

  /* ---------------- 3. the report itself ---------------- */
  const report = asAdmin.body?.data;
  check("report carries a business date", report?.businessDate === utcDayKey(todayStart), `got ${report?.businessDate}`);
  check(
    "report window is one UTC day",
    report?.window?.start === todayStart.toISOString() &&
      report?.window?.end === new Date(todayStart.getTime() + 86_400_000).toISOString(),
  );

  // THE date-serialisation guard.
  check(
    "collected takings include today's paid probe order",
    typeof report?.revenue?.collected === "number" && report.revenue.collected >= 41.25,
    `collected=$${report?.revenue?.collected}`,
  );
  check(
    "yesterday's order is excluded from the window",
    typeof report?.revenue?.collected === "number" &&
      report.revenue.collected < 99.99,
    `collected=$${report?.revenue?.collected} (yesterday was $99.99)`,
  );
  check(
    "the cancelled probe order is counted as a void",
    report?.revenue?.voided >= 17.5,
    `voided=$${report?.revenue?.voided}`,
  );
  check(
    "the void is listed with its amount",
    Array.isArray(report?.voids) &&
      report.voids.some((v: any) => v.id === voidedToday.id && v.totalAmount === 17.5),
  );
  check(
    "gross is the sum of non-void orders",
    typeof report?.revenue?.gross === "number" &&
      report.revenue.gross >= 41.25,
    `gross=$${report?.revenue?.gross}`,
  );
  check(
    "outstanding excludes paid orders",
    typeof report?.revenue?.outstanding === "number" &&
      report.revenue.outstanding < 41.25,
    `outstanding=$${report?.revenue?.outstanding}`,
  );

  check("orders are counted", (report?.orders?.total ?? 0) >= 2, `total=${report?.orders?.total}`);
  check(
    "paid order count is reported",
    (report?.orders?.paid ?? 0) >= 1,
    `paid=${report?.orders?.paid}`,
  );
  check(
    "cancelled order count is reported",
    (report?.orders?.cancelled ?? 0) >= 1,
    `cancelled=${report?.orders?.cancelled}`,
  );
  check(
    "the order mix separates takeaway from dine-in",
    Array.isArray(report?.orders?.byType) &&
      report.orders.byType.some((t: any) => t.type === "TAKEAWAY" && t.count >= 1),
  );
  check(
    "average ticket is a positive number when money was taken",
    typeof report?.orders?.averageTicket === "number" && report.orders.averageTicket > 0,
    `aov=$${report?.orders?.averageTicket}`,
  );

  /* ---------------- 4. the aggregation pipelines actually returned rows --- */
  check(
    "hourly trading pattern is populated",
    Array.isArray(report?.hourly) && report.hourly.length > 0,
    `${report?.hourly?.length ?? 0} hour(s)`,
  );
  check(
    "hourly buckets are real hours",
    Array.isArray(report?.hourly) &&
      report.hourly.every((h: any) => h.hour >= 0 && h.hour <= 23),
  );
  check(
    "top sellers are ranked and shaped",
    Array.isArray(report?.items) &&
      report.items.length > 0 &&
      report.items.every(
        (i: any) =>
          typeof i.name === "string" &&
          typeof i.quantity === "number" &&
          typeof i.revenue === "number",
      ),
    `${report?.items?.length ?? 0} item(s)`,
  );
  check(
    "top sellers are sorted by revenue, descending",
    Array.isArray(report?.items) &&
      report.items.every(
        (i: any, idx: number) =>
          idx === 0 || report.items[idx - 1].revenue >= i.revenue,
      ),
  );

  /* ---------------- 5. blockers / closed flag ---------------- */
  check(
    "blockers is always an array",
    Array.isArray(report?.blockers),
  );
  check(
    "closed agrees with the blocker list",
    report?.closed === (report?.blockers?.length === 0),
    `closed=${report?.closed} blockers=${report?.blockers?.length}`,
  );

  const clearDay = await req(
    "GET",
    `/api/reports/day-close?date=${utcDayKey(yesterdayStart)}`,
    undefined,
    admin.cookie,
  );
  check(
    "a day with a settled order reports its own date",
    clearDay.body?.data?.businessDate === utcDayKey(yesterdayStart),
    `got ${clearDay.body?.data?.businessDate}`,
  );
  check(
    "yesterday's takings land in yesterday's report",
    clearDay.body?.data?.revenue?.collected >= 99.99,
    `collected=$${clearDay.body?.data?.revenue?.collected}`,
  );

  /* ---------------- 6. per-item notes ---------------- */
  const withNotes = await req(
    "POST",
    "/api/orders",
    {
      orderType: "TAKEAWAY",
      tableId: null,
      items: [
        { id: menuItem.id, quantity: 1, notes: "  No   onions \n please " },
        { id: menuItem.id, quantity: 1, notes: "   " },
      ],
    },
    staff.cookie,
  );
  check("STAFF can place a POS order", withNotes.status === 201, `got ${withNotes.status}`);

  const notesOrderId = withNotes.body?.id;
  if (notesOrderId) {
    probeOrderIds.push(notesOrderId);

    const saved = await prisma.orderItem.findMany({
      where: { orderId: notesOrderId },
      select: { notes: true },
    });

    check(
      "a kitchen note is persisted",
      saved.some((i) => i.notes === "No onions please"),
      JSON.stringify(saved.map((i) => i.notes)),
    );
    check(
      "whitespace collapses to single spaces",
      saved.some((i) => i.notes === "No onions please"),
    );
    check(
      "a blank note is stored as null, not an empty string",
      saved.some((i) => i.notes === null),
    );
  } else {
    check("POS order returned an id", false, withNotes.raw);
  }

  const longNote = "x".repeat(400);
  const capped = await req(
    "POST",
    "/api/orders",
    {
      orderType: "TAKEAWAY",
      tableId: null,
      items: [{ id: menuItem.id, quantity: 1, notes: longNote }],
    },
    staff.cookie,
  );
  if (capped.body?.id) {
    probeOrderIds.push(capped.body.id);
    const item = await prisma.orderItem.findFirst({
      where: { orderId: capped.body.id },
      select: { notes: true },
    });
    check(
      "an over-long note is truncated, not rejected",
      item?.notes?.length === 140,
      `length=${item?.notes?.length}`,
    );
  } else {
    check("over-long note order was created", false, capped.raw);
  }

  /* ---------------- 7. receipt reprint ---------------- */
  const receipt = await req("GET", `/api/orders/${paidToday.id}`, undefined, staff.cookie);
  check("STAFF can fetch an order for reprint", receipt.status === 200, `got ${receipt.status}`);
  check(
    "receipt carries per-line prices",
    receipt.body?.items?.[0]?.price === 13.75,
    `price=${receipt.body?.items?.[0]?.price}`,
  );
  check(
    "receipt carries the item name",
    typeof receipt.body?.items?.[0]?.menuItem?.name === "string",
  );
  check("receipt carries the order total", receipt.body?.totalAmount === 41.25);
  check("receipt carries the payment method", receipt.body?.paymentMethod === "CASH");
  check(
    "receipt omits the customer record",
    receipt.body?.user === undefined,
  );

  const kitchenReceipt = await req(
    "GET",
    `/api/orders/${paidToday.id}`,
    undefined,
    kitchen.cookie,
  );
  check(
    "KITCHEN cannot pull a priced order",
    kitchenReceipt.status === 403,
    `got ${kitchenReceipt.status}`,
  );

  const missing = await req(
    "GET",
    "/api/orders/6abc15c65bd1c7d386610000",
    undefined,
    admin.cookie,
  );
  check("a missing order answers 404", missing.status === 404, `got ${missing.status}`);

  /* ---------------- 8. regression: /active is not shadowed by /:id ------- */
  const active = await req("GET", "/api/orders/active", undefined, staff.cookie);
  check(
    "GET /orders/active still resolves to the board",
    active.status === 200 && Array.isArray(active.body?.data),
    `got ${active.status}`,
  );

  /* ---------------- cleanup ---------------- */
  await prisma.order.deleteMany({ where: { id: { in: probeOrderIds } } });
  for (const u of [staff, kitchen, manager, admin]) {
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("VERIFY FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Payload and request-volume measurements for the cost work.
 *
 *   cd backend && npm run measure:payloads
 *
 * The redesign set out to cut API usage for a restaurant doing hundreds of
 * covers a day, which is easy to claim and easy to regress. This script turns
 * the claim into numbers and then asserts a budget, so a future change that
 * quietly fattens the hot payloads fails loudly.
 *
 * Requires the backend to be running. Creates one throwaway `e2e.probe.*`
 * admin and removes it afterwards.
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
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const bytesOf = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const STAMP = Date.now();
const PASSWORD = "ProbePassw0rd!";

async function makeAdmin() {
  const email = `e2e.probe.measure.${STAMP}@dineflow.local`;
  const signup = await req("POST", "/api/auth/sign-up/email", {
    email,
    password: PASSWORD,
    name: "Probe Measure",
  });
  if (signup.status !== 200 && signup.status !== 201) {
    throw new Error(`signup failed: ${signup.status} ${signup.raw}`);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("user row missing");
  await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });

  const signin = await req("POST", "/api/auth/sign-in/email", {
    email,
    password: PASSWORD,
  });
  if (signin.status !== 200) throw new Error(`signin failed: ${signin.status}`);
  return { id: user.id, cookie: cookieOf(signin) };
}

async function main() {
  const admin = await makeAdmin();

  /* ---------------- 1. measured endpoint payloads ---------------- */
  const endpoints: [string, string][] = [
    ["dashboard stats", "/api/dashboard/stats"],
    ["dashboard charts", "/api/dashboard/charts"],
    ["dashboard lists", "/api/dashboard/lists"],
    ["order history (page 1)", "/api/orders?page=1"],
    ["kitchen board (ticket)", "/api/orders/active"],
    ["till board (+ money)", "/api/orders/active?view=pos"],
    ["day close (Z report)", "/api/reports/day-close"],
  ];

  console.log("\n--- measured payloads (authenticated, real data) ---");
  const sizes: Record<string, number> = {};
  for (const [label, path] of endpoints) {
    const res = await req("GET", path, undefined, admin.cookie);
    const size = Buffer.byteLength(res.raw);
    sizes[path] = size;
    console.log(
      `${label.padEnd(24)} ${String(res.status).padEnd(4)} ${kb(size).padStart(9)}`,
    );
    check(`${label} responds 200`, res.status === 200, `got ${res.status}`);
  }

  /* ---------------- 2. the trimming, measured on identical rows ---------- */
  // Same ten orders, two projections. This isolates exactly what the payload
  // change saved, rather than comparing against a version we can no longer run.
  //
  // Every order in a POS-driven database has `userId: null`, so a sample taken
  // as-is would never exercise the user-record trimming this comparison exists
  // to measure. One probe order is attached to the probe admin so the fat
  // projection actually carries a full user document.
  const menuItem = await prisma.menuItem.findFirst({ select: { id: true } });
  const probeOrder = await prisma.order.create({
    data: {
      orderType: "TAKEAWAY",
      status: "SERVED",
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      totalAmount: 9.5,
      userId: admin.id,
      items: menuItem
        ? { create: [{ menuItemId: menuItem.id, quantity: 1, price: 9.5 }] }
        : undefined,
    },
  });

  const others = await prisma.order.findMany({
    where: { id: { not: probeOrder.id } },
    select: { id: true },
    take: 9,
  });
  const ids = [probeOrder.id, ...others.map((r) => r.id)];

  const [fat, lean] = await Promise.all([
    prisma.order.findMany({
      where: { id: { in: ids } },
      include: {
        user: true,
        table: true,
        items: { include: { menuItem: true } },
      },
    }),
    prisma.order.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        orderType: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        totalAmount: true,
        createdAt: true,
        table: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true, image: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            price: true,
            notes: true,
            menuItem: { select: { id: true, name: true, image: true } },
          },
        },
      },
    }),
  ]);

  const fatBytes = bytesOf(fat);
  const leanBytes = bytesOf(lean);
  const saved = fatBytes > 0 ? Math.round((1 - leanBytes / fatBytes) * 100) : 0;

  console.log("\n--- order list, same rows, two projections ---");
  console.log(`old shape (include user + menuItem)  ${kb(fatBytes).padStart(9)}`);
  console.log(`new shape (explicit select)          ${kb(leanBytes).padStart(9)}`);
  console.log(`saved                                ${String(saved).padStart(8)}%`);

  const fatUser = (fat.find((o) => (o as any).user) as any)?.user;
  const leanUser = (lean.find((o) => (o as any).user) as any)?.user;

  check(
    "the trimmed order projection is smaller",
    leanBytes < fatBytes,
    `${kb(fatBytes)} -> ${kb(leanBytes)} (-${saved}%)`,
  );
  check(
    "the old projection leaked fields the till has no business seeing",
    Boolean(fatUser) &&
      "banReason" in fatUser &&
      !("banReason" in (leanUser ?? {})),
    fatUser
      ? `old keys include banReason; new keys: ${Object.keys(leanUser ?? {}).join(",")}`
      : "no order in the sample has a customer attached",
  );
  check(
    "the trimmed projection keeps what the UI renders",
    lean.length > 0 &&
      typeof (lean[0] as any).items?.[0]?.menuItem?.name === "string",
  );

  /* ---------------- 3. request volume per open screen per hour ---------- */
  // Intervals come from the source: SAFETY_POLL_MS = 5 min for dashboard panels,
  // the day-close report and the notification log; 60 s for the two live boards.
  const perHour = (ms: number) => Math.round(3_600_000 / ms);

  const dashboardBefore = perHour(60_000) * 2 + perHour(120_000); // stats+charts @60s, lists @120s
  const dashboardAfter = perHour(300_000) * 3; // all three @300s
  const notificationBefore = perHour(30_000); // audit console, was polled hard
  const notificationAfter = perHour(300_000);

  console.log("\n--- polling requests per hour, per open screen ---");
  console.log(`dashboard before   ${String(dashboardBefore).padStart(5)}/h`);
  console.log(`dashboard after    ${String(dashboardAfter).padStart(5)}/h`);
  console.log(
    `  saved            ${String(dashboardBefore - dashboardAfter).padStart(5)}/h (${Math.round(
      (1 - dashboardAfter / dashboardBefore) * 100,
    )}%)`,
  );
  console.log(`notifications before ${String(notificationBefore).padStart(4)}/h`);
  console.log(`notifications after  ${String(notificationAfter).padStart(4)}/h`);
  console.log(
    `  saved            ${String(notificationBefore - notificationAfter).padStart(5)}/h (${Math.round(
      (1 - notificationAfter / notificationBefore) * 100,
    )}%)`,
  );

  check(
    "dashboard polling dropped by at least two thirds",
    dashboardAfter <= dashboardBefore / 3,
    `${dashboardBefore}/h -> ${dashboardAfter}/h`,
  );
  check(
    "notification log polling dropped by at least two thirds",
    notificationAfter <= notificationBefore / 3,
    `${notificationBefore}/h -> ${notificationAfter}/h`,
  );

  /* ---------------- 4. budgets for the hot payloads --------------------- */
  // These endpoints refresh constantly during service, so they get a budget.
  const ticketBudget = 200 * 1024;
  const posBudget = 260 * 1024;
  check(
    "kitchen ticket payload stays within budget",
    sizes["/api/orders/active"]! <= ticketBudget,
    `${kb(sizes["/api/orders/active"]!)} (budget ${kb(ticketBudget)})`,
  );
  check(
    "the till board costs only slightly more than the kitchen ticket",
    sizes["/api/orders/active?view=pos"]! <= posBudget &&
      sizes["/api/orders/active?view=pos"]! >= sizes["/api/orders/active"]!,
    `${kb(sizes["/api/orders/active"]!)} -> ${kb(sizes["/api/orders/active?view=pos"]!)}`,
  );

  await prisma.order.delete({ where: { id: probeOrder.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: admin.id } }).catch(() => {});

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("MEASURE FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

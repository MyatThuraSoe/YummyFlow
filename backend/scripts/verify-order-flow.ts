/**
 * End-to-end verification for the order-flow rework.
 *
 * Covers the parts of the redesign that are easy to regress silently:
 *   - the new `GET /api/orders/active` endpoint and its role gating
 *   - the split between the kitchen's status-only route and the admin
 *     dynamic-update route
 *   - that the trimmed payloads no longer leak the full user record
 *   - that SERVED / CANCELLED release the table
 *
 * Drives the REAL HTTP API, so the backend must already be running:
 *   cd backend && npm run dev          # in another terminal
 *   cd backend && npm run verify:order-flow
 *
 * Creates throwaway `e2e.probe.*` users (removable with
 * `scripts/cleanup-probe-data.ts`) and one probe order which it deletes itself.
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

/** Sign up a throwaway account, promote it, and return its session cookie. */
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

  // Sign in again so the session is established against the final role.
  const signin = await req("POST", "/api/auth/sign-in/email", {
    email,
    password: PASSWORD,
  });
  if (signin.status !== 200) {
    throw new Error(`signin failed for ${label}: ${signin.status} ${signin.raw}`);
  }

  return { id: user.id, email, cookie: cookieOf(signin) };
}

async function main() {
  /* ---------------- fixtures ---------------- */
  const menuItem = await prisma.menuItem.findFirst({ select: { id: true } });
  const table = await prisma.table.findFirst({ select: { id: true } });
  if (!menuItem) throw new Error("no menu item available to build a probe order");

  // Put the table back in rotation so the release assertion is meaningful.
  if (table) {
    await prisma.table.update({
      where: { id: table.id },
      data: { status: "AVAILABLE" },
    });
  }

  const order = await prisma.order.create({
    data: {
      orderType: table ? "DINE_IN" : "TAKEAWAY",
      status: "PENDING",
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      totalAmount: 12.5,
      tableId: table?.id ?? null,
      items: { create: [{ menuItemId: menuItem.id, quantity: 1, price: 12.5 }] },
    },
  });

  // Mirror what createPosOrder does for a dine-in order, so the "serving must
  // not silently free the table" assertion is actually testing something.
  if (table) {
    await prisma.table.update({
      where: { id: table.id },
      data: { status: "OCCUPIED" },
    });
  }

  /* ---------------- users ---------------- */
  const kitchen = await makeUser("kitchen", "KITCHEN");
  const staff = await makeUser("staff", "STAFF");
  const admin = await makeUser("admin", "ADMIN");
  const customer = await makeUser("customer", "CUSTOMER");

  /* ---------------- 1. access control ---------------- */
  const anon = await req("GET", "/api/orders/active");
  check("anonymous GET /orders/active is rejected", anon.status === 401, `got ${anon.status}`);

  const cust = await req("GET", "/api/orders/active", undefined, customer.cookie);
  check("CUSTOMER cannot read the kitchen board", cust.status === 403, `got ${cust.status}`);

  const kBoard = await req("GET", "/api/orders/active", undefined, kitchen.cookie);
  check("KITCHEN can read the kitchen board", kBoard.status === 200, `got ${kBoard.status}`);

  /* ---------------- 2. payload trimming ---------------- */
  const boardOrder = kBoard.body?.data?.find((o: any) => o.id === order.id);
  check("probe order appears on the board", Boolean(boardOrder));
  check(
    "board ticket omits payment + customer fields",
    boardOrder !== undefined &&
      boardOrder.paymentStatus === undefined &&
      boardOrder.user === undefined &&
      boardOrder.totalAmount === undefined,
  );
  check(
    "board includes a server clock for elapsed badges",
    typeof kBoard.body?.serverTime === "string",
  );

  /* ---------------- 3. kitchen status transitions ---------------- */
  const prep = await req(
    "PATCH",
    `/api/orders/${order.id}/status`,
    { status: "PREPARING" },
    kitchen.cookie,
  );
  check("KITCHEN can advance to PREPARING", prep.status === 200, `got ${prep.status}`);

  const badStatus = await req(
    "PATCH",
    `/api/orders/${order.id}/status`,
    { status: "COOKING" },
    kitchen.cookie,
  );
  check("unknown status is rejected", badStatus.status === 400, `got ${badStatus.status}`);

  const ready = await req(
    "PATCH",
    `/api/orders/${order.id}/status`,
    { status: "READY" },
    staff.cookie,
  );
  check("STAFF can advance to READY", ready.status === 200, `got ${ready.status}`);

  /* ---------------- 4. kitchen cannot touch payment ---------------- */
  const kitchenPayment = await req(
    "PATCH",
    `/api/orders/${order.id}`,
    { field: "paymentMethod", value: "CARD" },
    kitchen.cookie,
  );
  check(
    "KITCHEN cannot change payment method",
    kitchenPayment.status === 403,
    `got ${kitchenPayment.status}`,
  );

  const staffPayment = await req(
    "PATCH",
    `/api/orders/${order.id}`,
    { field: "paymentStatus", value: "FAILED" },
    staff.cookie,
  );
  check(
    "STAFF cannot use the broad admin update route",
    staffPayment.status === 403,
    `got ${staffPayment.status}`,
  );

  /* ---------------- 4b. the till's payment route ---------------- */
  const staffPay = await req(
    "PATCH",
    `/api/orders/${order.id}/payment`,
    { paymentStatus: "PAID" },
    staff.cookie,
  );
  check("STAFF can take payment", staffPay.status === 200, `got ${staffPay.status}`);

  const badPayment = await req(
    "PATCH",
    `/api/orders/${order.id}/payment`,
    { paymentStatus: "REFUNDED" },
    staff.cookie,
  );
  check("unknown payment status is rejected", badPayment.status === 400, `got ${badPayment.status}`);

  const emptyPayment = await req(
    "PATCH",
    `/api/orders/${order.id}/payment`,
    {},
    staff.cookie,
  );
  check("empty payment payload is rejected", emptyPayment.status === 400, `got ${emptyPayment.status}`);

  const kitchenPay = await req(
    "PATCH",
    `/api/orders/${order.id}/payment`,
    { paymentStatus: "PAID" },
    kitchen.cookie,
  );
  check("KITCHEN cannot take payment", kitchenPay.status === 403, `got ${kitchenPay.status}`);

  /* ---------------- 4c. the till's board shape ---------------- */
  const posBoard = await req(
    "GET",
    "/api/orders/active?view=pos",
    undefined,
    staff.cookie,
  );
  check("POS board is readable", posBoard.status === 200, `got ${posBoard.status}`);

  const posOrder = posBoard.body?.data?.find((o: any) => o.id === order.id);
  check("POS board includes the amount", posOrder?.totalAmount === 12.5, `got ${posOrder?.totalAmount}`);
  check("POS board includes payment state", posOrder?.paymentStatus === "PAID", `got ${posOrder?.paymentStatus}`);
  check(
    "POS board still omits the customer record",
    posOrder !== undefined && posOrder.user === undefined,
  );

  /* ---------------- 5. serving no longer frees the table ---------------- */
  const served = await req(
    "PATCH",
    `/api/orders/${order.id}/status`,
    { status: "SERVED" },
    staff.cookie,
  );
  check("STAFF can mark SERVED", served.status === 200, `got ${served.status}`);

  if (table) {
    const after = await prisma.table.findUnique({ where: { id: table.id } });
    check(
      "SERVED keeps the table occupied until staff clear it",
      after?.status === "OCCUPIED",
      `table=${after?.status}`,
    );

    /* ---------- 5b. explicit table turnover ---------- */
    const cleaning = await req(
      "PATCH",
      `/api/tables/${table.id}/status`,
      { status: "CLEANING" },
      staff.cookie,
    );
    check("staff can move a table to CLEANING", cleaning.status === 200, `got ${cleaning.status}`);

    const bogus = await req(
      "PATCH",
      `/api/tables/${table.id}/status`,
      { status: "NAPPING" },
      staff.cookie,
    );
    check("unknown table status is rejected", bogus.status === 400, `got ${bogus.status}`);

    const reset = await req(
      "PATCH",
      `/api/tables/${table.id}/status`,
      { status: "AVAILABLE" },
      staff.cookie,
    );
    check("a cleaned table returns to AVAILABLE", reset.status === 200, `got ${reset.status}`);

    const finalTable = await prisma.table.findUnique({ where: { id: table.id } });
    check("table ends up available", finalTable?.status === "AVAILABLE", `table=${finalTable?.status}`);
  }

  const boardAfter = await req("GET", "/api/orders/active", undefined, kitchen.cookie);
  check(
    "served order drops off the board",
    !boardAfter.body?.data?.some((o: any) => o.id === order.id),
  );

  /* ---------------- 6. admin dynamic update still works ---------------- */
  const adminPayment = await req(
    "PATCH",
    `/api/orders/${order.id}`,
    { field: "paymentMethod", value: "CARD" },
    admin.cookie,
  );
  check("ADMIN can change payment method", adminPayment.status === 200, `got ${adminPayment.status}`);

  /* ---------------- 7. history payload is trimmed ---------------- */
  const history = await req("GET", "/api/orders?page=1", undefined, admin.cookie);
  check("admin can read order history", history.status === 200, `got ${history.status}`);

  const first = history.body?.data?.[0];
  if (first) {
    const leaked = [
      "password",
      "banReason",
      "twoFactorEnabled",
    ].filter((k) => first.user && k in first.user);
    check(
      "history does not leak sensitive user fields",
      leaked.length === 0,
      leaked.length ? `leaked: ${leaked.join(", ")}` : "",
    );
    check(
      "history items omit the full menu item document",
      first.items?.[0]?.menuItem !== undefined &&
        first.items[0].menuItem.price === undefined &&
        first.items[0].menuItem.categoryId === undefined,
    );
  } else {
    check("history returned at least one order", false, "empty page");
  }

  /* ---------------- cleanup ---------------- */
  await prisma.order.delete({ where: { id: order.id } });
  for (const u of [kitchen, staff, admin, customer]) {
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

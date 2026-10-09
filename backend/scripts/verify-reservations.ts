/**
 * End-to-end verification for the reservation email flow.
 *
 * Proves that an explicitly-provided guest address receives the confirmation
 * (rather than the signed-in account address), and that a status change fires
 * the follow-up email.
 *
 * The backend must already be running:
 *   cd backend && npm run dev        # in another terminal
 *   cd backend && npm run verify:reservations
 */
import "dotenv/config";
import http from "node:http";
import { prisma } from "../src/lib/prisma";

const ORIGIN = "http://localhost:5173";
const BASE = { host: "127.0.0.1", port: 5000 };

function req(method: string, p: string, body?: unknown, cookie?: string) {
  return new Promise<{ status: number; body: any; cookies: string[] }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { Origin: ORIGIN };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    if (cookie) headers["Cookie"] = cookie;
    const r = http.request({ ...BASE, method, path: p, headers }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        let parsed: any = d;
        try {
          parsed = JSON.parse(d);
        } catch {}
        resolve({
          status: res.statusCode ?? 0,
          body: parsed,
          cookies: (res.headers["set-cookie"] as string[]) ?? [],
        });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let pass = 0;
let fail = 0;
const check = (l: string, ok: boolean, d = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${l}${d ? `  ${d}` : ""}`);
  ok ? pass++ : fail++;
};

const EMAIL = `resv.probe.${Date.now()}@dineflow.local`;
const GUEST_EMAIL = `guest.probe.${Date.now()}@dineflow.local`;
const PASSWORD = "ProbePassw0rd!";

/* sign up a CUSTOMER (default role) */
const signup = await req("POST", "/api/auth/sign-up/email", {
  email: EMAIL,
  password: PASSWORD,
  name: "Resv Probe",
});
check("customer signup", signup.status === 200, `status=${signup.status}`);

const signin = await req("POST", "/api/auth/sign-in/email", {
  email: EMAIL,
  password: PASSWORD,
});
const cookie = signin.cookies.map((c) => c.split(";")[0]).join("; ");
check("customer signin", signin.status === 200 && !!cookie);

/* pick a table straight from the DB — the CUSTOMER role can't list /api/tables */
const table = await prisma.table.findFirst();
check("found a table to book", Boolean(table), table ? `table=${table.name}` : "none");
if (!table) {
  console.error("ABORT: no table in DB to book — run the app seed first.");
  process.exitCode = 1;
  process.exit();
}

/* create a reservation WITH an explicit guest email */
const when = new Date(Date.now() + 36 * 60 * 60 * 1000);
const create = await req(
  "POST",
  "/api/reservations/create",
  {
    customerName: "Guest Probe",
    email: GUEST_EMAIL,
    date: when.toISOString(),
    guests: 2,
    tableId: table.id,
  },
  cookie,
);
check(
  "POST /api/reservations/create with email",
  create.status === 201 && create.body?.id,
  `status=${create.status} id=${create.body?.id?.slice(-6)}`,
);
check(
  "reservation persisted the guest email",
  create.body?.email === GUEST_EMAIL,
  `email=${create.body?.email}`,
);

await new Promise((r) => setTimeout(r, 1200));
const confirmLog = await prisma.notificationLog.findFirst({
  where: { template: "reservation-confirmation", recipient: GUEST_EMAIL },
  orderBy: { createdAt: "desc" },
});
check(
  "reservation-confirmation email sent to the GUEST address",
  Boolean(confirmLog),
  confirmLog ? `status=${confirmLog.status}` : "no log row",
);

/* confirm it -> should fire a status email */
const update = await req(
  "PATCH",
  `/api/reservations/${create.body.id}/status`,
  { status: "CONFIRMED" },
  cookie,
);
check("PATCH reservation status CONFIRMED", update.status === 200, `status=${update.status}`);

await new Promise((r) => setTimeout(r, 1200));
const statusLog = await prisma.notificationLog.findFirst({
  where: { template: "reservation-confirmed", recipient: GUEST_EMAIL },
  orderBy: { createdAt: "desc" },
});
check(
  "reservation status email sent on CONFIRMED",
  Boolean(statusLog),
  statusLog ? `status=${statusLog.status}` : "no log row",
);

/* clean up the reservation so repeat runs don't collide */
await prisma.reservation.delete({ where: { id: create.body.id } }).catch(() => {});

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);

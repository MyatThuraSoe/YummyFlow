/**
 * End-to-end verification for the PRO notification features (email + push)
 * and AI briefings.
 *
 * Drives the REAL HTTP API, so the backend must already be running:
 *   cd backend && npm run dev        # in another terminal
 *   cd backend && npm run verify:notifications
 *
 * It creates its own throwaway users (e2e.probe.* / e2e.victim.*) and exercises
 * every endpoint, asserting against NotificationLog rows in MongoDB. Safe to
 * re-run; the accounts it makes are prefixed so `scripts/cleanup-probe-data.ts`
 * can remove them.
 */
import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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

const cookieOf = (res: Res) =>
  res.cookies.map((c) => c.split(";")[0]).join("; ");

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const EMAIL = `e2e.probe.${Date.now()}@dineflow.local`;
const PASSWORD = "ProbePassw0rd!";

/* ---------- 1. signup (also exercises the welcome-email hook) ---------- */
const signup = await req("POST", "/api/auth/sign-up/email", {
  email: EMAIL,
  password: PASSWORD,
  name: "E2E Probe",
});
check("POST /api/auth/sign-up/email", signup.status === 200, `status=${signup.status}`);

await new Promise((r) => setTimeout(r, 1200)); // let the after-hook settle

const welcomeLog = await prisma.notificationLog.findFirst({
  where: { template: "welcome" },
  orderBy: { createdAt: "desc" },
});
check(
  "welcome email fired via databaseHooks.user.create.after",
  Boolean(welcomeLog),
  welcomeLog ? `status=${welcomeLog.status} to=${welcomeLog.recipient}` : "no log row",
);
check(
  "welcome email rendered to .mail-outbox",
  Boolean(welcomeLog?.meta && (welcomeLog.meta as any).preview),
  String((welcomeLog?.meta as any)?.preview ?? "").slice(-60),
);

/* ---------- 2. promote to ADMIN ---------- */
const user = await prisma.user.findUnique({ where: { email: EMAIL } });
if (!user) throw new Error("signup did not create a user");
await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
check("promoted probe user to ADMIN", true, user.id.slice(-6));

/* ---------- 3. sign in -> session cookie ---------- */
const signin = await req("POST", "/api/auth/sign-in/email", {
  email: EMAIL,
  password: PASSWORD,
});
const cookie = cookieOf(signin);
check("POST /api/auth/sign-in/email", signin.status === 200 && !!cookie, `cookie=${cookie.slice(0, 40)}`);

/* ---------- 4. notifications ---------- */
const pk = await req("GET", "/api/notifications/public-key");
check(
  "GET /api/notifications/public-key (public)",
  pk.status === 200 && typeof pk.body?.publicKey === "string" && pk.body.publicKey.length > 80,
  `len=${pk.body?.publicKey?.length}`,
);

const st = await req("GET", "/api/notifications/status", undefined, cookie);
check("GET /api/notifications/status (authed)", st.status === 200, JSON.stringify(st.body).slice(0, 120));

const noAuth = await req("GET", "/api/notifications/status");
check("GET /api/notifications/status rejects anonymous", noAuth.status === 401 || noAuth.status === 403, `status=${noAuth.status}`);

const te = await req("POST", "/api/notifications/test-email", { to: EMAIL }, cookie);
check("POST /api/notifications/test-email (ADMIN)", te.status === 200, JSON.stringify(te.body).slice(0, 160));

const ping = await req("POST", "/api/notifications/ping", {}, cookie);
check("POST /api/notifications/ping (authed)", ping.status === 200, JSON.stringify(ping.body).slice(0, 160));

/* subscribe / unsubscribe round-trip */
const fakeSub = {
  endpoint: `https://fcm.googleapis.com/fcm/send/probe-${Date.now()}`,
  keys: { p256dh: "BProbeProbeProbeProbeProbeProbeProbeProbeProbeProbeProbeProbeProbeProbeProbeProbe", auth: "probeauthprobeauth" },
};
const sub = await req("POST", "/api/notifications/subscribe", fakeSub, cookie);
check(
  "POST /api/notifications/subscribe",
  sub.status === 201 && sub.body?.success === true,
  `status=${sub.status} id=${sub.body?.id?.slice(-6)}`,
);
check("subscription persisted", (await prisma.pushSubscription.count({ where: { userId: user.id } })) === 1);

const testPush = await req("POST", "/api/notifications/test", {}, cookie);
check(
  "POST /api/notifications/test attempts a real VAPID send",
  testPush.status === 200 && testPush.body?.push?.enabled === true,
  `push=${JSON.stringify(testPush.body?.push)} email.mode=${testPush.body?.email?.mode}`,
);

const unsub = await req("POST", "/api/notifications/unsubscribe", { endpoint: fakeSub.endpoint }, cookie);
check("POST /api/notifications/unsubscribe", unsub.status === 200, JSON.stringify(unsub.body).slice(0, 120));

const logRes = await req("GET", "/api/notifications/log?take=5", undefined, cookie);
check("GET /api/notifications/log (ADMIN)", logRes.status === 200 && Array.isArray(logRes.body?.data), `rows=${logRes.body?.data?.length}`);

/* ---------- 5. briefings ---------- */
const bMetrics = await req("GET", "/api/briefings/metrics", undefined, cookie);
check(
  "GET /api/briefings/metrics",
  bMetrics.status === 200 && typeof bMetrics.body?.data?.metrics?.revenue?.current === "number",
  `revenue=${bMetrics.body?.data?.metrics?.revenue?.current} forecastPts=${bMetrics.body?.data?.forecast?.points?.length}`,
);

const bGen = await req("POST", "/api/briefings/generate", { kind: "EXECUTIVE" }, cookie);
check(
  "POST /api/briefings/generate (EXECUTIVE)",
  bGen.status === 201 && Boolean(bGen.body?.data?.headline),
  `headline="${bGen.body?.data?.headline}"`,
);

const bGenF = await req("POST", "/api/briefings/generate", { kind: "FORECAST" }, cookie);
check(
  "POST /api/briefings/generate (FORECAST)",
  bGenF.status === 201 && Boolean((bGenF.body?.data?.payload as any)?.forecast?.points?.length),
  `headline="${bGenF.body?.data?.headline}"`,
);

const bLatest = await req("GET", "/api/briefings/latest", undefined, cookie);
check(
  "GET /api/briefings/latest",
  bLatest.status === 200 && Boolean(bLatest.body?.data?.executive) && Boolean(bLatest.body?.data?.forecast),
  `exec=${bLatest.body?.data?.executive?.kind} fcast=${bLatest.body?.data?.forecast?.kind}`,
);

const bList = await req("GET", "/api/briefings?take=5", undefined, cookie);
check("GET /api/briefings (list)", bList.status === 200 && Array.isArray(bList.body?.data), `total=${bList.body?.total}`);

const bOne = await req("GET", `/api/briefings/${bGen.body.data.id}`, undefined, cookie);
check("GET /api/briefings/:id", bOne.status === 200 && bOne.body?.data?.id === bGen.body.data.id);

const bAnon = await req("GET", "/api/briefings/latest");
check("GET /api/briefings/latest rejects anonymous", bAnon.status === 401 || bAnon.status === 403, `status=${bAnon.status}`);

/* ---------- 6. account-status hook via better-auth admin plugin ---------- */
// Create a throwaway victim so we don't lock ourselves out.
const victim = await req("POST", "/api/auth/sign-up/email", {
  email: `e2e.victim.${Date.now()}@dineflow.local`,
  password: PASSWORD,
  name: "Ban Victim",
});
const victimRow = await prisma.user.findUnique({
  where: { email: victim.body?.user?.email ?? "" },
});
check("created victim user for ban test", Boolean(victimRow));

const beforeBan = await prisma.notificationLog.count({ where: { template: "account-suspended" } });
const ban = await req(
  "POST",
  "/api/auth/admin/ban-user",
  { userId: victimRow!.id, banReason: "E2E probe ban" },
  cookie,
);
check(
  "POST /api/auth/admin/ban-user (ADMIN)",
  ban.status === 200,
  `status=${ban.status} ${JSON.stringify(ban.body).slice(0, 100)}`,
);

await new Promise((r) => setTimeout(r, 1500));
const afterBan = await prisma.notificationLog.count({ where: { template: "account-suspended" } });
check(
  "account-suspended email fired via databaseHooks.user.update.after",
  afterBan === beforeBan + 1,
  `logs ${beforeBan} -> ${afterBan}`,
);

const unban = await req(
  "POST",
  "/api/auth/admin/unban-user",
  { userId: victimRow!.id },
  cookie,
);
check("POST /api/auth/admin/unban-user (ADMIN)", unban.status === 200, `status=${unban.status}`);

await new Promise((r) => setTimeout(r, 1500));
const restored = await prisma.notificationLog.count({ where: { template: "account-restored" } });
check("account-restored email fired on unban", restored >= 1, `rows=${restored}`);

/* ---------- summary ---------- */
const outbox = path.resolve(process.cwd(), ".mail-outbox");
const files = fs.existsSync(outbox) ? fs.readdirSync(outbox) : [];
console.log(`\noutbox files: ${files.length}`);
const logs = await prisma.notificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 12 });
console.log("\nnotification log:");
logs.forEach((l) => console.log(`  ${l.channel.padEnd(5)} ${l.status.padEnd(7)} ${l.template.padEnd(24)} -> ${l.recipient}`));
console.log(`\nbriefing rows: ${await prisma.briefing.count()}`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);

await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);

/**
 * HTTP smoke test: walks every declared route and asserts it responds
 * correctly against the seeded database.
 *
 *   Pass A  no cookie  -> guarded routes must 401 (middleware rejects before
 *                         the controller, so this never mutates data)
 *   Pass B  admin cookie -> every GET route must return < 400 with real data
 *   Pass C  CUSTOMER cookie -> an ADMIN/MANAGER-only route must 403
 *
 * The backend must already be running and the DB seeded:
 *   cd backend && npm run seed
 *   cd backend && npm run dev          # in another terminal
 *   cd backend && npm run verify:api
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import { prisma } from "../src/lib/prisma";

const BASE = { host: "127.0.0.1", port: Number(process.env.PORT ?? 5000) };

function req(
  method: string,
  p: string,
  cookie?: string,
  body?: unknown,
): Promise<{ status: number; body: any; cookie?: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { Origin: "http://localhost:5173" };
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
        const setCookie = res.headers["set-cookie"];
        resolve({
          status: res.statusCode ?? 0,
          body: parsed,
          cookie: Array.isArray(setCookie)
            ? setCookie.map((c) => c.split(";")[0]).join("; ")
            : undefined,
        });
      });
    });
    r.setTimeout(20000, () => r.destroy(new Error(`timeout ${method} ${p}`)));
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

/* ---------- discover routes from source (same bounded-window rules) ---------- */

type Route = { mount: string; verb: string; path: string; guarded: boolean };

const MOUNTS: Record<string, string> = {
  "activities-log": "/api/activities-log",
  briefing: "/api/briefings",
  category: "/api/category",
  dashboard: "/api/dashboard",
  inventory: "/api/inventory",
  menu: "/api/menu",
  notifications: "/api/notifications",
  order: "/api/orders",
  reports: "/api/reports",
  reservation: "/api/reservations",
  table: "/api/tables",
  waitlist: "/api/waitlist",
};

function collectRoutes(): Route[] {
  const dir = join(import.meta.dirname, "../src/routes");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const out: Route[] = [];

  for (const file of files) {
    const short = file.replace(/\.ts$/, "");
    const mount = MOUNTS[short];
    if (!mount) continue;
    const raw = readFileSync(join(dir, file), "utf8");

    // Guards declared at router level apply to every later route.
    let inherited = false;
    const useRe = /\w+Router\.use\(([^)]*)\)/g;
    let u: RegExpExecArray | null;
    while ((u = useRe.exec(raw)) !== null) {
      if (u[1]!.includes("requireAuth")) inherited = true;
    }

    const sites: { verb: string; path: string; index: number }[] = [];
    const re = /\w+[Rr]outer\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      sites.push({ verb: m[1]!.toUpperCase(), path: m[2]!, index: m.index });
    }

    for (let i = 0; i < sites.length; i++) {
      const site = sites[i]!;
      // Bound the text at the NEXT declaration: a fixed-width window
      // over-reads and reports the following route's guards as this one's.
      const next = sites[i + 1]?.index ?? raw.length;
      const window = raw.slice(site.index, next);
      out.push({
        mount,
        verb: site.verb,
        path: site.path,
        guarded: inherited || window.includes("requireAuth"),
      });
    }
  }
  return out;
}

/**
 * Resolve `:name` in a route path to a real seeded row.
 *
 * `:id` alone is ambiguous — it means a briefing under /api/briefings, an
 * order under /api/orders, a table under /api/tables. Resolve it per mount
 * rather than guessing globally, otherwise the request 404s on a valid route.
 */
function fillParams(mount: string, p: string): string {
  return p.replace(/:(\w+)/g, (_all, name: string) => {
    const v = name === "id" ? MOUNT_ID[mount] : NAMED_ID[name];
    if (!v) throw new Error(`no seeded id for ${mount}${p} :${name}`);
    return v;
  });
}

let MOUNT_ID: Record<string, string | undefined>;
let NAMED_ID: Record<string, string | undefined>;

async function signIn(email: string, password: string): Promise<string> {
  const r = await req("POST", "/api/auth/sign-in/email", undefined, {
    email,
    password,
  });
  if (r.status !== 200) throw new Error(`sign-in failed ${r.status}`);
  if (!r.cookie) throw new Error("no session cookie returned");
  return r.cookie;
}

async function main() {
  const routes = collectRoutes();
  const publicRoutes = routes.filter((r) => !r.guarded);
  const guardedRoutes = routes.filter((r) => r.guarded);
  console.log(
    `discovered ${routes.length} routes (${publicRoutes.length} public, ${guardedRoutes.length} guarded)\n`,
  );

  /* real ids so param routes resolve to 200, not 404 */
  const [menu, feedback, briefing, table, order, reservation, ingredient, wait, category] =
    await Promise.all([
      prisma.menuItem.findFirst({ where: { isAvailable: true } }),
      prisma.feedback.findFirst(),
      prisma.briefing.findFirst(),
      prisma.table.findFirst(),
      prisma.order.findFirst(),
      prisma.reservation.findFirst(),
      prisma.ingredient.findFirst(),
      prisma.waitlist.findFirst(),
      prisma.category.findFirst(),
    ]);

  /* `:id` means a different model per mount — resolve it per mount */
  MOUNT_ID = {
    "/api/briefings": briefing?.id,
    "/api/menu": menu?.id,
    "/api/orders": order?.id,
    "/api/tables": table?.id,
    "/api/reservations": reservation?.id,
    "/api/inventory": ingredient?.id,
    "/api/waitlist": wait?.id,
    "/api/category": category?.id,
  };
  NAMED_ID = { menuItemId: menu?.id, feedbackId: feedback?.id };

  check(
    "seeded rows available for param routes",
    Boolean(menu && table && order && reservation && ingredient && briefing && category),
    `menu=${!!menu} table=${!!table} order=${!!order} reservation=${!!reservation} briefing=${!!briefing} ingredient=${!!ingredient} category=${!!category}`,
  );

  /* preflight: is the server up at all? */
  try {
    const health = await req("GET", "/");
    check("server responds on /", health.status === 200, `got ${health.status}`);
  } catch (e) {
    console.error(`\nserver not reachable: ${(e as Error).message}`);
    console.error("start it first:  cd backend && npm run dev");
    process.exit(2);
  }

  const admin = await signIn("admin@dineflow.test", "Password123!");
  check("sign-in as admin@dineflow.test", true);

  const dineout = await signIn("diner@dineflow.test", "Password123!");
  check("sign-in as diner@dineflow.test", true);

  /* ---------- Pass A: unauthenticated requests to guarded routes -> 401 ---------- */
  console.log("\n--- Pass A: unauthenticated (guarded routes must 401) ---");
  let aPass = 0;
  let aSkipped = 0;
  for (const r of guardedRoutes) {
    let path: string;
    try {
      path = fillParams(r.mount, r.path);
    } catch (e) {
      // A skip here means the auth check never ran — report it, don't hide it.
      aSkipped++;
      check(`${r.verb} ${r.mount}${r.path} unauthenticated`, false, `skipped: ${(e as Error).message}`);
      continue;
    }
    try {
      const res = await req(r.verb, r.mount + path);
      if (res.status === 401) aPass++;
      else check(`${r.verb} ${r.mount}${r.path} unauthenticated`, false, `got ${res.status}`);
    } catch (e) {
      check(`${r.verb} ${r.mount}${r.path} unauthenticated`, false, (e as Error).message);
    }
  }
  check(
    `all ${guardedRoutes.length} guarded routes rejected unauthenticated requests`,
    aPass === guardedRoutes.length && aSkipped === 0,
    `${aPass}/${guardedRoutes.length} -> 401, ${aSkipped} skipped`,
  );

  /* ---------- Pass B: authenticated GETs return real data ---------- */
  console.log("\n--- Pass B: authenticated GETs ---");
  let bTotal = 0;
  for (const r of routes) {
    if (r.verb !== "GET") continue;
    bTotal++;
    const path = fillParams(r.mount, r.path);
    try {
      const res = await req("GET", r.mount + path, admin);
      const label = `GET ${r.mount}${r.path}`;
      if (res.status >= 400) {
        check(label, false, `got ${res.status}`);
      } else {
        const hasData =
          res.body && typeof res.body === "object" && Object.keys(res.body).length > 0;
        check(label, hasData, hasData ? String(res.status) : "empty body");
      }
    } catch (e) {
      check(`GET ${r.mount}${r.path}`, false, (e as Error).message);
    }
  }

  /* public GETs must work with no cookie at all */
  for (const r of publicRoutes) {
    if (r.verb !== "GET") continue;
    const path = fillParams(r.mount, r.path);
    try {
      const res = await req("GET", r.mount + path);
      check(`GET ${r.mount}${r.path} (public, no cookie)`, res.status < 400, String(res.status));
    } catch (e) {
      check(`GET ${r.mount}${r.path} (public, no cookie)`, false, (e as Error).message);
    }
  }

  /* ---------- Pass C: role enforcement ---------- */
  console.log("\n--- Pass C: role enforcement ---");
  // dashboard is ADMIN/MANAGER only; a CUSTOMER session must be refused.
  // Fail loudly if the route ever disappears rather than skipping silently.
  const target = "/api/dashboard/stats";
  check(
    "role-check target route still exists",
    guardedRoutes.some((r) => r.mount + r.path === target),
    target,
  );
  try {
    const res = await req("GET", target, dineout);
    check("CUSTOMER denied on ADMIN/MANAGER GET /api/dashboard/stats", res.status === 403, `got ${res.status}`);
  } catch (e) {
    check("CUSTOMER denied on ADMIN/MANAGER GET /api/dashboard/stats", false, (e as Error).message);
  }

  /* write-path auth check: a destructive route with no cookie must 401.
     requireAuth runs before the controller, so this never deletes anything. */
  const destructive = guardedRoutes.find(
    (r) => r.verb === "DELETE" && r.mount === "/api/tables",
  );
  if (destructive && MOUNT_ID[destructive.mount]) {
    try {
      const res = await req(
        "DELETE",
        destructive.mount + fillParams(destructive.mount, destructive.path),
      );
      check(
        "DELETE /api/tables/:id/delete unauthenticated",
        res.status === 401,
        `got ${res.status}`,
      );
    } catch (e) {
      check("DELETE /api/tables/:id/delete unauthenticated", false, (e as Error).message);
    }
  } else {
    check("DELETE /api/tables/:id/delete unauthenticated", false, "route or id not found");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Fresh-install exit gate: boots the real API against an empty PostgreSQL
 * schema (dropped afterwards — the seeded development database is untouched)
 * and walks the first-run setup path — setup-status reports needsSetup,
 * register-first-admin provisions the restaurant and the OWNER, the
 * registration is audited, setup flips to complete, a second registration is
 * rejected and the new owner can sign in with username/password.
 *
 * Run:  npm run verify:fresh
 */
import "./_fresh-install-env.js";
import http from "node:http";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { initSocket } from "../src/lib/socket.js";
import { prisma } from "../src/lib/prisma.js";

const PORT = 4597;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const SCHEMA = "fresh_install_verify";

let passed = 0;
function ok(name: string) {
  passed += 1;
  console.log(`  \u2713 ${name}`);
}

interface ApiOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { "x-session-token": opts.token } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data: data as T };
}

const OWNER = {
  username: "fresh.owner",
  email: "fresh.owner@example.com",
  password: "FreshPass123!",
  firstName: "Fresh",
  lastName: "Owner",
  restaurantName: "Fresh Install Bistro",
};

async function main() {
  console.log(`\nMegaDine fresh-install verification (schema ${SCHEMA})\n`);
  execSync("npx prisma db push --skip-generate", { stdio: "inherit", env: process.env });

  const server = http.createServer(createApp());
  initSocket(server);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    // ── Empty database ──────────────────────────────────
    const status0 = await api<{ success: boolean; data: { needsSetup: boolean } }>("/auth/setup-status");
    assert.equal(status0.status, 200);
    assert.equal(status0.data.success, true);
    assert.equal(status0.data.data.needsSetup, true);
    ok("setup-status reports needsSetup on an empty database");

    // ── First admin registration ────────────────────────
    const reg = await api<{ success: boolean; data: { user: { username: string; role: string } } }>(
      "/auth/register-first-admin",
      { method: "POST", body: OWNER },
    );
    assert.equal(reg.status, 201, JSON.stringify(reg.data));
    assert.equal(reg.data.data.user.username, OWNER.username);
    assert.equal(reg.data.data.user.role, "OWNER");
    ok("register-first-admin creates the OWNER account");

    const restaurant = await prisma.restaurant.findFirst();
    assert.ok(restaurant, "restaurant should be provisioned");
    assert.equal(restaurant.name, OWNER.restaurantName);
    ok("restaurant record provisioned with the given name");

    const auditRow = await prisma.auditLog.findFirst({ where: { action: "USER_REGISTER" } });
    assert.ok(auditRow, "USER_REGISTER audit entry expected");
    ok("USER_REGISTER audit entry written");

    // ── Setup is now complete ───────────────────────────
    const status1 = await api<{ success: boolean; data: { needsSetup: boolean } }>("/auth/setup-status");
    assert.equal(status1.status, 200);
    assert.equal(status1.data.data.needsSetup, false);
    ok("setup-status flips to complete");

    const again = await api<{ error: { code: string } }>("/auth/register-first-admin", {
      method: "POST",
      body: { ...OWNER, username: "second.owner", email: "second.owner@example.com" },
    });
    assert.equal(again.status, 403, JSON.stringify(again.data));
    assert.equal(again.data.error.code, "auth.firstadmin.notallowed");
    ok("second registration is rejected with auth.firstadmin.notallowed");

    // ── The new owner can sign in ───────────────────────
    const login = await api<{ user: { username: string; role: string }; token: string }>("/auth/login", {
      method: "POST",
      body: { username: OWNER.username, password: OWNER.password },
    });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.equal(login.data.user.role, "OWNER");
    const me = await api<{ user: { username: string; role: string } }>("/auth/me", { token: login.data.token });
    assert.equal(me.data.user.username, OWNER.username);
    ok("new owner signs in with username/password and resolves the session");

    console.log(`\n\u2705 Fresh-install verification passed: ${passed} checks\n`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\n\u274c Fresh-install verification FAILED\n", err);
  process.exit(1);
});

/**
 * Extended exit-gate: covers the endpoint round added for the PRD-audit pass —
 * menu variant/modifier CRUD, recipes, plan-limit enforcement, expenses from
 * the cash drawer, cash movements, receipt preview/reprint, void-line
 * (manager PIN rules), Z-report and business-day close.
 *
 * Repeatable: every created record is cleaned up (menu items/tables/terminals,
 * recipe lines, cash movements, expenses). A business day is closed only once
 * per test run.
 *
 * Run:  npm run verify:extended
 */
import "./_hermetic-env.js";
import http from "node:http";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { initSocket } from "../src/lib/socket.js";
import { prisma } from "../src/lib/prisma.js";
import { businessDateFor } from "../src/lib/businessDay.js";
import { getMachineId } from "../src/lib/machine.js";
import { setRuntimeLicenseKey } from "../src/lib/license.js";

const PORT = 4598;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

// Demo PINs by default; override via PIN_<ROLE> (must match the seeded users).
const PIN_OWNER = process.env.PIN_OWNER ?? "0000";
const PIN_ADMIN = process.env.PIN_ADMIN ?? "4444";
const PIN_CASHIER = process.env.PIN_CASHIER ?? "1111";

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

async function login(pin: string): Promise<{ token: string }> {
  const { status, data } = await api<{ token: string }>("/auth/login", { method: "POST", body: { pin } });
  assert.equal(status, 200, `login pin ${pin} failed: ${JSON.stringify(data)}`);
  return { token: data.token };
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function main() {
  const restaurant = await prisma.restaurant.findFirst();
  assert.ok(restaurant, "No restaurant found — run `npm run seed` first");

  const server = http.createServer(createApp());
  initSocket(server);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`\nMegaDine Basic extended verification against http://127.0.0.1:${PORT}\n`);

  try {
  const cashier = await login(PIN_CASHIER);
  const admin = await login(PIN_ADMIN);

    // ── License + plan limits ────────────────────────────
    const lic = await api<{
      limits: { edition: string; maxTerminals: number; maxTables: number; maxMenuItems: number };
      usage: { terminals: number; tables: number; menuItems: number };
    }>("/admin/license", { token: admin.token });
    assert.equal(lic.status, 200);
    assert.equal(lic.data.limits.edition, "BASIC");
    assert.ok(lic.data.usage.terminals <= lic.data.limits.maxTerminals);
    assert.ok(lic.data.usage.tables <= lic.data.limits.maxTables);
    assert.ok(lic.data.usage.menuItems <= lic.data.limits.maxMenuItems);
    ok("license endpoint reports BASIC plan and usage within limits");

    // Terminals: create → 201 (usage +1) unless at cap → 409.
    if (lic.data.usage.terminals >= lic.data.limits.maxTerminals) {
      const cap = await api("/admin/terminals", { method: "POST", token: admin.token, body: { name: "Extra", type: "POS" } });
      assert.equal(cap.status, 409);
      ok("terminal create blocked at plan cap with 409");
    } else {
      const t = await api<{ terminal: { id: string } }>("/admin/terminals", { method: "POST", token: admin.token, body: { name: `Verify ${Date.now()}`, type: "POS" } });
      assert.equal(t.status, 201);
      await prisma.terminal.delete({ where: { id: t.data.terminal.id } });
      ok("terminal create succeeds under the cap and cleans up");
    }

    // Tables: same adaptive check + unique table number.
    const tables = await api<{ tables: { number: number }[] }>("/tables", { token: admin.token });
    const nextNumber = Math.max(0, ...tables.data.tables.map((t) => t.number)) + 1;
    if (lic.data.usage.tables >= lic.data.limits.maxTables) {
      const cap = await api("/tables", { method: "POST", token: admin.token, body: { number: nextNumber, name: "Verify" } });
      assert.equal(cap.status, 409);
      ok("table create blocked at plan cap with 409");
    } else {
      const t = await api<{ table: { id: string } }>("/tables", { method: "POST", token: admin.token, body: { number: nextNumber, name: "Verify" } });
      assert.equal(t.status, 201);
      await prisma.restaurantTable.delete({ where: { id: t.data.table.id } });
      ok("table create succeeds under the cap and cleans up");
    }

    // Menu item: adaptive + WARN on whether 409 or 201 path hit.
    const menu = await api<{ categories: { id: string; items: { id: string; name: string; price: string }[] }[] }>("/menu", { token: cashier.token });
    const catId = menu.data.categories[0]!.id;
    const burger = menu.data.categories.flatMap((c) => c.items).find((i) => i.name === "Classic Burger")!;
    const coke = menu.data.categories.flatMap((c) => c.items).find((i) => i.name === "Coca-Cola")!;
    const itemName = `Verify Item ${Date.now()}`;
    if (lic.data.usage.menuItems >= lic.data.limits.maxMenuItems) {
      const cap = await api("/menu/items", { method: "POST", token: admin.token, body: { categoryId: catId, name: itemName, price: 1 } });
      assert.equal(cap.status, 409);
      ok("menu item create blocked at plan cap with 409");
    } else {
      const it = await api<{ item: { id: string } }>("/menu/items", { method: "POST", token: admin.token, body: { categoryId: catId, name: itemName, price: 1 } });
      assert.equal(it.status, 201, JSON.stringify(it.data));
      const after = await api<{ usage: { menuItems: number } }>("/admin/license", { token: admin.token });
      assert.equal(after.data.usage.menuItems, lic.data.usage.menuItems + 1);
      const del = await api(`/menu/items/${it.data.item.id}`, { method: "DELETE", token: admin.token });
      assert.equal(del.status, 200);
      ok("menu item create/deletion reflected in plan usage");
    }

    // ── Menu variant + modifier CRUD (on a seeded item) ──
    const v = await api<{ variant: { id: string } }>(`/menu/items/${burger.id}/variants`, { method: "POST", token: admin.token, body: { name: "Verify Large", priceAdjust: 1.5 } });
    assert.equal(v.status, 201, JSON.stringify(v.data));
    const vp = await api<{ variant: { priceAdjust: string } }>(`/menu/variants/${v.data.variant.id}`, { method: "PATCH", token: admin.token, body: { priceAdjust: 2 } });
    assert.equal(vp.status, 200);
    assert.equal(Number(vp.data.variant.priceAdjust), 2);
    const vd = await api(`/menu/variants/${v.data.variant.id}`, { method: "DELETE", token: admin.token });
    assert.equal(vd.status, 200);
    ok("menu variant create/patch/delete works");

    const g = await api<{ group: { id: string } }>(`/menu/items/${burger.id}/modifier-groups`, { method: "POST", token: admin.token, body: { name: "Verify Options", required: false } });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    const opt = await api<{ option: { id: string } }>(`/menu/modifier-groups/${g.data.group.id}/options`, { method: "POST", token: admin.token, body: { name: "Extra", price: 0.5 } });
    assert.equal(opt.status, 201);
    const op = await api<{ option: { price: string } }>(`/menu/modifier-options/${opt.data.option.id}`, { method: "PATCH", token: admin.token, body: { price: 1 } });
    assert.equal(op.status, 200);
    assert.equal(Number(op.data.option.price), 1);
    const od = await api(`/menu/modifier-options/${opt.data.option.id}`, { method: "DELETE", token: admin.token });
    assert.equal(od.status, 200);
    const gd = await api(`/menu/modifier-groups/${g.data.group.id}`, { method: "DELETE", token: admin.token });
    assert.equal(gd.status, 200);
    ok("modifier group option create/patch/delete works");

    // ── Recipe editor ────────────────────────────────────
    const inv = await api<{ ingredients: { id: string }[] }>("/inventory/ingredients", { token: admin.token });
    const ings = inv.data.ingredients;
    assert.ok(ings.length >= 2, "expected seeded ingredients for the recipe test");
    const recipe = await api(`/inventory/items/${burger.id}/recipe`, { method: "PUT", token: admin.token, body: { lines: [{ ingredientId: ings[0]!.id, quantity: 0.05 }, { ingredientId: ings[1]!.id, quantity: 0.02 }] } });
    assert.equal(recipe.status, 200);
    const got = await api<{ lines: unknown[] }>(`/inventory/items/${burger.id}/recipe`, { token: admin.token });
    assert.equal(got.data.lines.length, 2);
    await api(`/inventory/items/${burger.id}/recipe`, { method: "PUT", token: admin.token, body: { lines: [] } });
    const reset = await api<{ lines: unknown[] }>(`/inventory/items/${burger.id}/recipe`, { token: admin.token });
    assert.equal(reset.data.lines.length, 0);
    ok("recipe lines apply and reset via PUT");

    // ── Shift lifecycle ──────────────────────────────────
    const openingFloatCents = 5000;
    const cur = await api<{ shift: { id: string } | null; summary?: { expectedCash: number } }>("/shifts/current", { token: cashier.token });
    if (cur.data.shift) {
      const closeOld = await api(`/shifts/${cur.data.shift.id}/close`, { method: "POST", token: cashier.token, body: { actualCash: (cur.data.summary?.expectedCash ?? 0) / 100, notes: "verify normalization" } });
      assert.ok(closeOld.status >= 200 && closeOld.status < 300);
    }
    const sh = await api<{ shift: { id: string } }>("/shifts/open", { method: "POST", token: cashier.token, body: { openingFloat: openingFloatCents / 100 } });
    assert.equal(sh.status, 201, JSON.stringify(sh.data));
    const shiftId = sh.data.shift.id;
    ok("shift opened for extended flow");

    // Cash movements show up on the X-report.
    const paidIn = await api<{ movement: { id: string } }>(`/shifts/${shiftId}/movements`, { method: "POST", token: cashier.token, body: { type: "PAID_IN", amount: 20, reason: "verify paid-in" } });
    const safeDrop = await api<{ movement: { id: string } }>(`/shifts/${shiftId}/movements`, { method: "POST", token: cashier.token, body: { type: "SAFE_DROP", amount: 10, reason: "verify safe drop" } });
    assert.equal(paidIn.status, 201);
    assert.equal(safeDrop.status, 201);
    const x1 = await api<{ report: { paidIn: number; paidOut: number; safeDrops: number } }>(`/shifts/${shiftId}/x-report`, { token: cashier.token });
    assert.equal(x1.data.report.paidIn, 2000);
    assert.equal(x1.data.report.safeDrops, 1000);
    assert.equal(x1.data.report.paidOut, 0);
    ok("cash movements (PAID_IN / SAFE_DROP) reconcile in the X-report");
    const movList = await api<{ movements: { id: string; type: string; direction: string }[] }>(`/shifts/${shiftId}/movements`, { token: cashier.token });
    assert.equal(movList.status, 200, JSON.stringify(movList.data));
    assert.ok(movList.data.movements.some((m) => m.id === paidIn.data.movement.id && m.direction === "IN"));
    assert.ok(movList.data.movements.some((m) => m.id === safeDrop.data.movement.id && m.direction === "OUT"));
    ok("shift movements list is available for the shift report");
    await prisma.cashMovement.delete({ where: { id: paidIn.data.movement.id } });
    await prisma.cashMovement.delete({ where: { id: safeDrop.data.movement.id } });

    // Expense paid from the drawer → linked PAID_OUT movement.
    const exp = await api<{ expense: { id: string } }>("/expenses", { method: "POST", token: admin.token, body: { amount: 5, category: "Cleaning", payee: "Verify", fromDrawer: true, shiftId } });
    assert.equal(exp.status, 201, JSON.stringify(exp.data));
    const mov = await prisma.cashMovement.findFirst({ where: { shiftId, type: "PAID_OUT", reason: { startsWith: "Expense:" } }, orderBy: { createdAt: "desc" } });
    assert.ok(mov, "expected a PAID_OUT movement for a drawer expense");
    ok(`drawer expense creates a PAID_OUT cash movement (${mov!.amount})`);
    await prisma.cashMovement.delete({ where: { id: mov!.id } });
    await prisma.expense.delete({ where: { id: exp.data.expense.id } });

    // Order + payment + receipt + reprint + void-line rules.
    const o = await api<{ order: { id: string; orderNumber: number; total: string; lines: { id: string; isVoided: boolean }[] } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: { channel: "TAKEAWAY", idempotencyKey: `ext-${Date.now()}`, items: [{ menuItemId: burger.id, quantity: 1 }] },
    });
    assert.equal(o.status, 201, JSON.stringify(o.data));
    const orderId = o.data.order.id;
    const total = Number(o.data.order.total);

    const paid = await api<{ order: { status: string; paymentStatus: string } }>("/payments", {
      method: "POST",
      token: cashier.token,
      body: { orderId, shiftId, idempotencyKey: `ext-pay-${orderId}`, payments: [{ method: "CASH", amount: total, cashReceived: total + 0.01 }] },
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.data));
    assert.equal(paid.data.order.status, "COMPLETED");
    ok("extended order paid and completed");

    const rb = await api<{ receipt: string }>(`/orders/${orderId}/receipt`, { token: cashier.token });
    assert.equal(rb.status, 200);
    assert.ok(
      rb.data.receipt.includes("Order #") && rb.data.receipt.includes(String(o.data.order.orderNumber)),
      "receipt should include the order number",
    );
    const rp = await api<{ printed: boolean }>(`/orders/${orderId}/reprint`, { method: "POST", token: cashier.token });
    assert.equal(rp.status, 200);
    assert.ok(rp.data.printed === true);
    const reprintAudit = await prisma.auditLog.count({ where: { restaurantId: restaurant.id, action: "RECEIPT_REPRINT" } });
    assert.ok(reprintAudit >= 1);
    ok("receipt preview + reprint work and are audited");

    // Unsent line → cashier can void without a manager PIN.
    const v1 = await api<{ order: { id: string; lines: { id: string; isVoided: boolean }[] } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: { channel: "TAKEAWAY", items: [{ menuItemId: coke.id, quantity: 1 }] },
    });
    const vline = v1.data.order.lines[0]!.id;
    const voided = await api(`/orders/${v1.data.order.id}/void-line`, { method: "POST", token: cashier.token, body: { lineId: vline, reason: "verify-void" } });
    assert.equal(voided.status, 200, JSON.stringify(voided.data));
    await api(`/orders/${v1.data.order.id}/cancel`, { method: "POST", token: cashier.token, body: { reason: "verify cleanup" } });
    ok("cashier voids an unsent line without manager PIN");

    // Sent line → cashier needs a manager PIN.
    const v2 = await api<{ order: { id: string; lines: { id: string }[] } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: { channel: "TAKEAWAY", items: [{ menuItemId: burger.id, quantity: 1 }] },
    });
    const sent = await api(`/orders/${v2.data.order.id}/send-to-kitchen`, { method: "POST", token: cashier.token });
    assert.ok(sent.data.tickets >= 1);
    const noPin = await api(`/orders/${v2.data.order.id}/void-line`, { method: "POST", token: cashier.token, body: { lineId: v2.data.order.lines[0]!.id, reason: "verify-void" } });
    assert.ok(noPin.status === 400 || noPin.status === 403, `expected 400/403, got ${noPin.status}`);
  const withPin = await api(`/orders/${v2.data.order.id}/void-line`, { method: "POST", token: cashier.token, body: { lineId: v2.data.order.lines[0]!.id, reason: "verify-void", managerPin: PIN_OWNER } });
  assert.equal(withPin.status, 200);
  await api(`/orders/${v2.data.order.id}/cancel`, { method: "POST", token: cashier.token, body: { reason: "verify cleanup", managerPin: PIN_OWNER } });
    ok("manager PIN required (and works) to void a kitchen-sent line");

    // ── Round-2 items, occupied-table guard, partial payments ──
    const menuFull = await api<{ categories: { items: { id: string; modifierGroups: { options: { id: string }[] }[] }[] }[] }>("/menu", { token: cashier.token });
    const modItem = menuFull.data.categories.flatMap((c) => c.items).find((i) => i.modifierGroups.some((g) => g.options.length));
    const modOpt = modItem?.modifierGroups.find((g) => g.options.length)?.options[0]?.id;

    const r2 = await api<{ order: { id: string; total: string } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: { channel: "TAKEAWAY", items: [{ menuItemId: coke.id, quantity: 1 }] },
    });
    const r2Total = Number(r2.data.order.total);
    const r2add = await api<{ order: { total: string } }>(`/orders/${r2.data.order.id}/items`, {
      method: "POST",
      token: cashier.token,
      body: { items: [{ menuItemId: modItem ? modItem.id : burger.id, quantity: 1, ...(modOpt ? { modifierOptionIds: [modOpt] } : {}) }] },
    });
    assert.equal(r2add.status, 200, JSON.stringify(r2add.data));
    assert.ok(Number(r2add.data.order.total) > r2Total, "adding items must raise the order total");
    const r2full = await api<{ order: { lines: { isVoided: boolean; modifiers: { nameSnapshot: string }[] }[] } }>(`/orders/${r2.data.order.id}`, { token: cashier.token });
    if (modItem) {
      assert.ok(
        r2full.data.order.lines.some((l) => !l.isVoided && l.modifiers.length > 0),
        "added line must keep its modifiers",
      );
    }
    await api(`/orders/${r2.data.order.id}/cancel`, { method: "POST", token: cashier.token, body: { reason: "verify cleanup" } });
    ok("round-2 items append to an existing order with modifiers and recalculated total");

    const tblList = await api<{ tables: { id: string; status: string }[] }>("/tables", { token: cashier.token });
    const freeTable = tblList.data.tables.find((t) => t.status === "AVAILABLE");
    if (freeTable) {
      const d1 = await api<{ order: { id: string } }>("/orders", {
        method: "POST",
        token: cashier.token,
        body: { channel: "DINE_IN", tableId: freeTable.id, items: [{ menuItemId: burger.id, quantity: 1 }] },
      });
      assert.equal(d1.status, 201, JSON.stringify(d1.data));
      const d2 = await api("/orders", {
        method: "POST",
        token: cashier.token,
        body: { channel: "DINE_IN", tableId: freeTable.id, items: [{ menuItemId: burger.id, quantity: 1 }] },
      });
      assert.equal(d2.status, 409, `expected 409 on occupied table, got ${d2.status}`);
      const blockedClear = await api(`/tables/${freeTable.id}/clear`, { method: "POST", token: admin.token });
      assert.equal(blockedClear.status, 409, `expected 409 clearing a table with an open order, got ${blockedClear.status}`);
      await api(`/orders/${d1.data.order.id}/cancel`, { method: "POST", token: cashier.token, body: { reason: "verify cleanup" } });
      const okClear = await api(`/tables/${freeTable.id}/clear`, { method: "POST", token: admin.token });
      assert.equal(okClear.status, 200);
      ok("occupied table rejects new orders and clear-table while an order is open");
    } else {
      ok("occupied-table guard skipped (no AVAILABLE table)");
    }

    const pp = await api<{ order: { id: string; total: string } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: { channel: "TAKEAWAY", items: [{ menuItemId: coke.id, quantity: 1 }] },
    });
    const ppTotal = Number(pp.data.order.total);
    const half = Math.round((ppTotal / 2) * 100) / 100;
    const part1 = await api<{ order: { paymentStatus: string } }>("/payments", {
      method: "POST",
      token: cashier.token,
      body: { orderId: pp.data.order.id, idempotencyKey: `part1-${pp.data.order.id}`, payments: [{ method: "CASH", amount: half, cashReceived: half }] },
    });
    assert.equal(part1.status, 201, JSON.stringify(part1.data));
    assert.equal(part1.data.order.paymentStatus, "PENDING");
    const replayPart = await api<{ order: { amountPaid: string } }>("/payments", {
      method: "POST",
      token: cashier.token,
      body: { orderId: pp.data.order.id, idempotencyKey: `part1-${pp.data.order.id}`, payments: [{ method: "CASH", amount: half, cashReceived: half }] },
    });
    assert.equal(Number(replayPart.data.order.amountPaid), half, "replaying a key must not charge twice");
    const rest = Math.round((ppTotal - half) * 100) / 100;
    const part2 = await api<{ order: { paymentStatus: string } }>("/payments", {
      method: "POST",
      token: cashier.token,
      body: { orderId: pp.data.order.id, idempotencyKey: `part2-${pp.data.order.id}`, payments: [{ method: "CASH", amount: rest, cashReceived: rest }] },
    });
    assert.equal(part2.data.order.paymentStatus, "SUCCEEDED");
    ok("partial payment stays PENDING, replays are idempotent, balance settles the order");

    // Close the shift, reconciling exactly.
    const closed = await api<{ variance: string }>(`/shifts/${shiftId}/close`, {
      method: "POST",
      token: cashier.token,
      body: { actualCash: (openingFloatCents + Math.round(total * 100)) / 100, notes: "verify extended" },
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    assert.equal(Number(closed.data.variance), 0);
    ok("shift closes with zero variance after extended flow");

    // ── Z-report + business-day close ────────────────────
    const cfg = await api<{ restaurant: { businessDayCutoff: string } }>("/admin/settings", { token: admin.token });
    const day = businessDateFor(new Date(), cfg.data.restaurant.businessDayCutoff);
    const iso = localDate(day);
    const zr = await api<{ report: { netSales: number; orderCount: number; cash: { expectedCash: number } } }>(`/reports/z-report?date=${iso}`, { token: admin.token });
    assert.equal(zr.status, 200);
    assert.ok(zr.data.report.orderCount >= 1, "z-report should aggregate today's completed orders");
    ok("Z-report aggregates the business day's sales");

    const closes = await api<{ closes: { businessDate: string }[] }>("/reports/day-closes", { token: admin.token });
    const alreadyClosed = closes.data.closes.some((c) => localDate(new Date(c.businessDate)) === iso);
    if (alreadyClosed) {
      ok("business day already closed earlier (duplicate close skipped)");
    } else {
      const closeDay = await api<{ close: { variance: string }; report: { orderCount: number } }>("/reports/z-report/close", {
        method: "POST",
        token: admin.token,
        body: { date: `${iso}T00:00:00.000Z`, actualCash: zr.data.report.cash.expectedCash / 100, notes: "verify extended" },
      });
      assert.equal(closeDay.status, 200, JSON.stringify(closeDay.data));
      assert.equal(Number(closeDay.data.close.variance), 0);
      const after = await api<{ closes: { businessDate: string }[] }>("/reports/day-closes", { token: admin.token });
      assert.ok(after.data.closes.some((c) => localDate(new Date(c.businessDate)) === iso));
      ok("business day closed and recorded in the day-closes ledger");
    }

    // ── Platform: setup, credentials, users, guards, license, variance ──
    const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "owner123";

    const setupStatus = await api<{ success: boolean; data: { needsSetup: boolean } }>("/auth/setup-status");
    assert.equal(setupStatus.status, 200);
    assert.equal(setupStatus.data.data.needsSetup, false);
    ok("setup-status reports an initialized installation");

    const stamp = Date.now();
    const firstAdmin = await api<{ error: { code: string } }>("/auth/register-first-admin", {
      method: "POST",
      body: { username: `late_${stamp}`, email: `late_${stamp}@example.com`, password: "password123", firstName: "Late", lastName: "Admin" },
    });
    assert.equal(firstAdmin.status, 403);
    assert.equal(firstAdmin.data.error.code, "auth.firstadmin.notallowed");
    ok("register-first-admin is rejected once setup is complete");

    const badLogin = await api<{ error: { code: string } }>("/auth/login", {
      method: "POST",
      body: { username: "owner", password: "definitely-wrong" },
    });
    assert.equal(badLogin.status, 401);
    assert.equal(badLogin.data.error.code, "auth.login.failed");
    const ownerLogin = await api<{ user: { id: string; username: string; role: string }; token: string }>("/auth/login", {
      method: "POST",
      body: { username: "owner", password: ownerPassword },
    });
    assert.equal(ownerLogin.status, 200, JSON.stringify(ownerLogin.data));
    assert.equal(ownerLogin.data.user.username, "owner");
    assert.equal(ownerLogin.data.user.role, "OWNER");
    const ownerToken = ownerLogin.data.token;
    const ownerId = ownerLogin.data.user.id;
    const emailLogin = await api<{ user: { username: string } }>("/auth/login", {
      method: "POST",
      body: { email: "Owner@MegaDine.Local", password: ownerPassword },
    });
    assert.equal(emailLogin.status, 200);
    assert.equal(emailLogin.data.user.username, "owner");
    ok("credential login works by username and by case-insensitive email");

    // Purge temp users left behind by a previously aborted run.
    const staleUsers = await prisma.user.findMany({ where: { username: { startsWith: "verify_" } }, select: { id: true } });
    if (staleUsers.length > 0) {
      const staleIds = staleUsers.map((u) => u.id);
      await prisma.auditLog.deleteMany({ where: { userId: { in: staleIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: staleIds } } });
      await prisma.user.deleteMany({ where: { id: { in: staleIds } } });
    }

    // Staff CRUD + duplicate handling.
    const tempUsername = `verify_w_${stamp}`;
    const tempEmail = `verify_w_${stamp}@example.com`;
    const tempPassword = "verify-pass-123";
    const created = await api<{ success: boolean; data: { user: { id: string; username: string; capabilities: string[] } } }>("/users", {
      method: "POST",
      token: ownerToken,
      body: { username: tempUsername, email: tempEmail, password: tempPassword, firstName: "Vera", lastName: "Verify", role: "WAITER", pin: "918273" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const temp = created.data.data.user;
    assert.ok(temp.capabilities.includes("pos.use"));
    ok("staff user created (envelope + capability matrix)");

    const dupU = await api<{ error: { code: string } }>("/users", {
      method: "POST",
      token: ownerToken,
      body: { username: tempUsername, email: `other_${stamp}@example.com`, password: tempPassword, firstName: "Dup", lastName: "User", role: "WAITER" },
    });
    assert.equal(dupU.status, 409);
    assert.equal(dupU.data.error.code, "validation.duplicate.username");
    const dupE = await api<{ error: { code: string } }>("/users", {
      method: "POST",
      token: ownerToken,
      body: { username: `other_${stamp}`, email: tempEmail.toUpperCase(), password: tempPassword, firstName: "Dup", lastName: "User", role: "WAITER" },
    });
    assert.equal(dupE.status, 409);
    assert.equal(dupE.data.error.code, "validation.duplicate.email");
    ok("duplicate username/email (case-insensitive) rejected with specific codes");

    const userList = await api<{ success: boolean; data: { users: { username: string | null }[] } }>("/users", { token: ownerToken });
    assert.ok(userList.data.data.users.some((u) => u.username === tempUsername));
    const stats = await api<{ success: boolean; data: { totalSales: number; totalRevenue: number } }>(`/users/${temp.id}/stats`, { token: ownerToken });
    assert.equal(stats.status, 200);
    assert.equal(stats.data.data.totalSales, 0);
    ok("user list + per-user stats respond in the envelope");

    // Password lockout: five failures engage a 423; reset through the DB.
    let lastBad = 0;
    for (let i = 0; i < 5; i += 1) {
      const bad = await api("/auth/login", { method: "POST", body: { username: tempUsername, password: `wrong-password-${i}` } });
      lastBad = bad.status;
    }
    assert.equal(lastBad, 401);
    const locked = await api<{ error: { code: string } }>("/auth/login", { method: "POST", body: { username: tempUsername, password: "wrong-password-x" } });
    assert.equal(locked.status, 423);
    assert.equal(locked.data.error.code, "auth.login.locked");
    await prisma.user.update({ where: { id: temp.id }, data: { failedPinAttempts: 0, lockoutUntil: null } });
    ok("password lockout engages at the configured threshold (423)");

    // Two sessions: change password kills the other, keeps the current one.
    const t1 = await api<{ token: string }>("/auth/login", { method: "POST", body: { username: tempUsername, password: tempPassword } });
    const t2 = await api<{ token: string }>("/auth/login", { method: "POST", body: { username: tempUsername, password: tempPassword } });
    assert.equal(t1.status, 200);
    assert.equal(t2.status, 200);
    const wrongCurrent = await api<{ error: { code: string } }>("/auth/change-password", {
      method: "POST",
      token: t1.data.token,
      body: { currentPassword: "nope-nope-1", newPassword: "verify-pass-456" },
    });
    assert.equal(wrongCurrent.status, 403);
    assert.equal(wrongCurrent.data.error.code, "auth.current.password.incorrect");
    const changedPw = await api<{ success: boolean }>("/auth/change-password", {
      method: "POST",
      token: t1.data.token,
      body: { currentPassword: tempPassword, newPassword: "verify-pass-456" },
    });
    assert.equal(changedPw.status, 200);
    assert.equal(changedPw.data.success, true);
    const deadSession = await api("/auth/me", { token: t2.data.token });
    assert.equal(deadSession.status, 401);
    const aliveSession = await api("/auth/me", { token: t1.data.token });
    assert.equal(aliveSession.status, 200);
    const relogin = await api("/auth/login", { method: "POST", body: { username: tempUsername, password: "verify-pass-456" } });
    assert.equal(relogin.status, 200);
    ok("change-password invalidates other sessions and the new password logs in");

    const lang = await api<{ success: boolean; data: { user: { preferredLanguage: string } } }>("/users/me/language?lang=ja", { method: "PATCH", token: t1.data.token });
    assert.equal(lang.status, 200);
    assert.equal(lang.data.data.user.preferredLanguage, "ja");
    const badLang = await api("/users/me/language?lang=xx", { method: "PATCH", token: t1.data.token });
    assert.equal(badLang.status, 400);
    ok("preferred language updates and rejects unsupported codes");

    const upd = await api<{ success: boolean; data: { user: { phone: string | null } } }>(`/users/${temp.id}`, {
      method: "PUT",
      token: ownerToken,
      body: { phone: "+95 9 000 000" },
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.data.user.phone, "+95 9 000 000");
    ok("admin updates a staff user");

    // Soft delete: hidden from lists, sessions purged, cannot log in.
    const del = await api(`/users/${temp.id}`, { method: "DELETE", token: ownerToken });
    assert.equal(del.status, 200);
    const afterDel = await api<{ success: boolean; data: { users: { username: string | null }[] } }>("/users", { token: ownerToken });
    assert.ok(!afterDel.data.data.users.some((u) => u.username === tempUsername));
    assert.equal((await api("/auth/me", { token: t1.data.token })).status, 401);
    assert.equal((await api("/auth/login", { method: "POST", body: { username: tempUsername, password: "verify-pass-456" } })).status, 401);
    ok("soft delete hides the user, purges sessions and blocks login");

    // Admin guards: deactivate the seeded admin so the owner is the last guard.
    const staffList = await api<{ success: boolean; data: { users: { id: string; username: string | null }[] } }>("/users", { token: ownerToken });
    const seededAdmin = staffList.data.data.users.find((u) => u.username === "admin")!;
    assert.ok(seededAdmin, "seeded admin user must exist");
    assert.equal((await api(`/users/${seededAdmin.id}`, { method: "PUT", token: ownerToken, body: { isActive: false } })).status, 200);

    const selfDemote = await api<{ error: { code: string } }>(`/users/${ownerId}`, { method: "PUT", token: ownerToken, body: { role: "MANAGER" } });
    assert.equal(selfDemote.status, 409);
    assert.equal(selfDemote.data.error.code, "auth.lastadmin.demote");
    const selfOff = await api<{ error: { code: string } }>(`/users/${ownerId}`, { method: "PUT", token: ownerToken, body: { isActive: false } });
    assert.equal(selfOff.status, 409);
    assert.equal(selfOff.data.error.code, "auth.user.self.deactivate");
    const selfDel = await api<{ error: { code: string } }>(`/users/${ownerId}`, { method: "DELETE", token: ownerToken });
    assert.equal(selfDel.status, 409);
    assert.equal(selfDel.data.error.code, "auth.user.self.deactivate");
    assert.equal((await api(`/users/${seededAdmin.id}`, { method: "PUT", token: ownerToken, body: { isActive: true } })).status, 200);
    ok("last-admin demote, self-deactivate and self-delete are blocked (409)");

    // ── License activation (§7) ──
    const licStatus = await api<{ success: boolean; data: { machineId: string; edition: string; licensed: boolean; reason: string } }>("/license/status", { token: ownerToken });
    assert.equal(licStatus.status, 200);
    assert.equal(licStatus.data.data.reason, "no_license");
    assert.equal(licStatus.data.data.edition, "BASIC");
    assert.equal(licStatus.data.data.licensed, false);
    assert.ok(licStatus.data.data.machineId.length > 0);
    ok("license status reports BASIC / no_license without a key");

    const garbage = await api<{ error: { code: string } }>("/license/activate", { method: "POST", token: ownerToken, body: { licenseKey: "x".repeat(64) } });
    assert.equal(garbage.status, 400);
    assert.equal(garbage.data.error.code, "LICENSE_INVALID");
    ok("activation rejects a malformed key (LICENSE_INVALID)");

    const synth = (over: Record<string, unknown>) =>
      Buffer.from(
        JSON.stringify({
          restaurantName: "Verify",
          edition: "PROFESSIONAL",
          maxTerminals: 5,
          maxTables: 50,
          maxMenuItems: 200,
          features: ["pos"],
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          hardwareFingerprint: getMachineId(),
          signature: "verify-script",
          ...over,
        }),
      ).toString("base64");

    const wrongMachine = await api<{ error: { code: string } }>("/license/activate", { method: "POST", token: ownerToken, body: { licenseKey: synth({ hardwareFingerprint: "not-this-machine" }) } });
    assert.equal(wrongMachine.status, 400);
    assert.equal(wrongMachine.data.error.code, "LICENSE_MACHINE_MISMATCH");
    const expiredKey = await api<{ error: { code: string } }>("/license/activate", { method: "POST", token: ownerToken, body: { licenseKey: synth({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() }) } });
    assert.equal(expiredKey.status, 400);
    assert.equal(expiredKey.data.error.code, "LICENSE_EXPIRED");
    ok("activation distinguishes machine mismatch and expiry");

    const valid = await api<{ success: boolean; data: { edition: string; licensed: boolean; reason: string; limits: { maxTables: number } } }>("/license/activate", { method: "POST", token: ownerToken, body: { licenseKey: synth({}) } });
    assert.equal(valid.status, 200, JSON.stringify(valid.data));
    assert.equal(valid.data.data.edition, "PROFESSIONAL");
    assert.equal(valid.data.data.licensed, true);
    assert.equal(valid.data.data.reason, "none");
    assert.equal(valid.data.data.limits.maxTables, 50);
    const persisted = await prisma.restaurant.findUnique({ where: { id: restaurant.id } });
    assert.ok(persisted?.licenseKey, "activation must persist the key to the restaurant");
    const adminLic = await api<{ limits: { edition: string } }>("/admin/license", { token: ownerToken });
    assert.equal(adminLic.data.limits.edition, "PROFESSIONAL");
    ok("a valid key activates, persists and raises plan limits");

    await prisma.restaurant.update({ where: { id: restaurant.id }, data: { licenseKey: null } });
    setRuntimeLicenseKey(null);
    const restored = await api<{ data: { edition: string; reason: string } }>("/license/status", { token: ownerToken });
    assert.equal(restored.data.data.edition, "BASIC");
    ok("license state restored to BASIC for repeat runs");

    // ── Cash variance (§6): refund window + tolerance boundary ──
    const tolCents = Math.round(Number(restaurant.cashVarianceTolerance ?? 10) * 100);
    const open1 = await api<{ shift: { id: string } }>("/shifts/open", { method: "POST", token: cashier.token, body: { openingFloat: 0 } });
    assert.equal(open1.status, 201, JSON.stringify(open1.data));
    const varShift1 = open1.data.shift.id;

    const vo = await api<{ order: { id: string; total: string } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: { channel: "TAKEAWAY", items: [{ menuItemId: coke.id, quantity: 1 }] },
    });
    assert.equal(vo.status, 201, JSON.stringify(vo.data));
    const vTotal = Number(vo.data.order.total);
    const vPay = await api("/payments", {
      method: "POST",
      token: cashier.token,
      body: { orderId: vo.data.order.id, shiftId: varShift1, idempotencyKey: `var-pay-${vo.data.order.id}`, payments: [{ method: "CASH", amount: vTotal, cashReceived: vTotal }] },
    });
    assert.equal(vPay.status, 201);
    const vRefund = await api("/payments/refund", {
      method: "POST",
      token: admin.token,
      body: { orderId: vo.data.order.id, amount: vTotal, reason: "variance verify", managerPin: PIN_OWNER },
    });
    assert.equal(vRefund.status, 200, JSON.stringify(vRefund.data));

    const tCents = Math.round(vTotal * 100);
    const x = await api<{ report: { cashSales: number; refundsInWindow: number; expectedCash: number; varianceTolerance: number } }>(`/shifts/${varShift1}/x-report`, { token: cashier.token });
    assert.equal(x.data.report.cashSales, tCents);
    assert.equal(x.data.report.refundsInWindow, tCents);
    assert.equal(x.data.report.expectedCash, 0);
    assert.equal(x.data.report.varianceTolerance, tolCents / 100);
    ok("refunds are attributed to the refund time window (drawer returns to 0)");

    const close1 = await api<{ varianceExceedsTolerance: boolean }>(`/shifts/${varShift1}/close`, {
      method: "POST",
      token: cashier.token,
      body: { actualCash: tolCents / 100 },
    });
    assert.equal(close1.status, 200, JSON.stringify(close1.data));
    assert.equal(close1.data.varianceExceedsTolerance, false);
    ok("variance exactly at tolerance is NOT flagged");

    const open2 = await api<{ shift: { id: string } }>("/shifts/open", { method: "POST", token: cashier.token, body: { openingFloat: 0 } });
    assert.equal(open2.status, 201);
    const close2 = await api<{ varianceExceedsTolerance: boolean }>(`/shifts/${open2.data.shift.id}/close`, {
      method: "POST",
      token: cashier.token,
      body: { actualCash: (tolCents + 1) / 100 },
    });
    assert.equal(close2.status, 200);
    assert.equal(close2.data.varianceExceedsTolerance, true);
    ok("variance one cent over tolerance IS flagged");

    // Card-only refunds never touch the drawer (PRD §6.2 exclusion).
    const open3 = await api<{ shift: { id: string } }>("/shifts/open", { method: "POST", token: cashier.token, body: { openingFloat: 0 } });
    assert.equal(open3.status, 201, JSON.stringify(open3.data));
    const cardOrder = await api<{ order: { id: string; total: string } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: { channel: "TAKEAWAY", items: [{ menuItemId: coke.id, quantity: 1 }] },
    });
    assert.equal(cardOrder.status, 201, JSON.stringify(cardOrder.data));
    const cardTotal = Number(cardOrder.data.order.total);
    const cardPay = await api("/payments", {
      method: "POST",
      token: cashier.token,
      body: {
        orderId: cardOrder.data.order.id,
        shiftId: open3.data.shift.id,
        idempotencyKey: `var-card-${cardOrder.data.order.id}`,
        payments: [{ method: "CARD", amount: cardTotal }],
      },
    });
    assert.equal(cardPay.status, 201, JSON.stringify(cardPay.data));
    const cardRefund = await api("/payments/refund", {
      method: "POST",
      token: admin.token,
      body: { orderId: cardOrder.data.order.id, amount: cardTotal, reason: "card-only verify", managerPin: PIN_OWNER },
    });
    assert.equal(cardRefund.status, 200, JSON.stringify(cardRefund.data));
    const xCard = await api<{ report: { cashSales: number; refundsInWindow: number; expectedCash: number } }>(
      `/shifts/${open3.data.shift.id}/x-report`,
      { token: cashier.token },
    );
    assert.equal(xCard.data.report.cashSales, 0);
    assert.equal(xCard.data.report.refundsInWindow, 0);
    assert.equal(xCard.data.report.expectedCash, 0);
    ok("card-only refunds are excluded from the cash drawer expectation");
    const close3 = await api<{ varianceExceedsTolerance: boolean }>(`/shifts/${open3.data.shift.id}/close`, {
      method: "POST",
      token: cashier.token,
      body: { actualCash: 0 },
    });
    assert.equal(close3.status, 200, JSON.stringify(close3.data));
    assert.equal(close3.data.varianceExceedsTolerance, false);

    // ── Receipt customization (spec: receipt config, preview, per-order) ──
    const rc = await api<{ success: boolean; data: { config: { paperWidth: number; showTax: boolean; fontSize: string } } }>("/receipts/config", { token: cashier.token });
    assert.equal(rc.status, 200);
    assert.equal(rc.data.data.config.paperWidth, 80);
    assert.equal(rc.data.data.config.showTax, true);
    assert.equal(rc.data.data.config.fontSize, "medium");
    const rcDefaults = await api<{ success: boolean; data: { defaults: { paperWidth: number } } }>("/receipts/defaults", { token: admin.token });
    assert.equal(rcDefaults.status, 200);
    assert.equal(rcDefaults.data.data.defaults.paperWidth, 80);
    ok("receipt config auto-provisions with defaults");

    const badLogo = await api("/receipts/config", { method: "PUT", token: admin.token, body: { logo: "data:image/gif;base64,R0lGODlh" } });
    assert.equal(badLogo.status, 400);
    const putRc = await api<{ success: boolean; data: { config: { showTax: boolean } } }>("/receipts/config", {
      method: "PUT",
      token: admin.token,
      body: { showTax: false },
    });
    assert.equal(putRc.status, 200, JSON.stringify(putRc.data));
    assert.equal(putRc.data.data.config.showTax, false);
    const rcAfter = await api<{ data: { config: { showTax: boolean } } }>("/receipts/config", { token: admin.token });
    assert.equal(rcAfter.data.data.config.showTax, false);
    const rcAudit = await prisma.auditLog.count({ where: { restaurantId: restaurant.id, action: "RECEIPT_CONFIG_UPDATED" } });
    assert.ok(rcAudit >= 1);
    ok("receipt config persists updates, validates logos and is audited");

    const prevOff = await api<{ data: { html: string } }>("/receipts/preview", { method: "POST", token: admin.token, body: { showTax: false } });
    assert.equal(prevOff.status, 200);
    assert.ok(!prevOff.data.data.html.includes("Tax"), "preview override should remove the tax line");
    const prevOn = await api<{ data: { html: string } }>("/receipts/preview", { method: "POST", token: admin.token, body: { showTax: true, alignment: "center" } });
    assert.equal(prevOn.status, 200);
    assert.ok(prevOn.data.data.html.includes("Tax"));
    assert.ok(prevOn.data.data.html.includes('class="r-center"'));
    ok("receipt preview reflects unsaved overrides");

    const testPrint = await api<{ data: { ok: boolean; simulated: boolean; preview: string } }>("/receipts/test-print", { method: "POST", token: admin.token });
    assert.equal(testPrint.status, 200);
    assert.equal(testPrint.data.data.ok, true);
    assert.equal(testPrint.data.data.simulated, true);
    assert.ok(testPrint.data.data.preview.length > 0);
    ok("receipt test-print simulates on the default printer mode");

    const orHtml = await api<{ data: { html: string } }>(`/receipts/order/${orderId}/html`, { token: admin.token });
    assert.equal(orHtml.status, 200);
    assert.ok(orHtml.data.data.html.includes(String(o.data.order.orderNumber)));
    const orText = await api<{ data: { text: string } }>(`/receipts/order/${orderId}/text`, { token: admin.token });
    assert.equal(orText.status, 200);
    assert.ok(orText.data.data.text.length > 0);
    const missing = await api(`/receipts/order/00000000-0000-0000-0000-000000000000/html`, { token: admin.token });
    assert.equal(missing.status, 404);
    ok("order receipt html/text render and unknown orders 404");

    const printOrder = await api<{ data: { ok: boolean; simulated: boolean; receipt: string } }>(`/receipts/order/${orderId}/print`, { method: "POST", token: cashier.token });
    assert.equal(printOrder.status, 200, JSON.stringify(printOrder.data));
    assert.equal(printOrder.data.data.ok, true);
    assert.ok(printOrder.data.data.receipt.includes("*** REPRINT ***"));
    const reprintAudit2 = await prisma.auditLog.count({ where: { restaurantId: restaurant.id, action: "RECEIPT_REPRINTED" } });
    assert.ok(reprintAudit2 >= 1);
    ok("order reprint prints (simulated) with marker and is audited");

    await api("/receipts/config", { method: "PUT", token: admin.token, body: { showTax: true } });
    ok("receipt config reset for repeat runs");

    // ── Phase 1 roadmap: SERVED lifecycle, kitchen priority, reservations ──
    const menuNow = await api<{ categories: { items: { id: string }[] }[] }>("/menu", { token: cashier.token });
    const anyItemId = menuNow.data.categories.flatMap((c) => c.items)[0].id;
    const tablesNow = await api<{ tables: { id: string; number: number; status: string }[] }>("/tables", { token: cashier.token });
    const availTable = tablesNow.data.tables.find((t) => t.status === "AVAILABLE");

    const servedOrder = await api<{ order: { id: string; total: string; status: string; priority: string } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: {
        channel: availTable ? "DINE_IN" : "TAKEAWAY",
        tableId: availTable?.id ?? null,
        items: [{ menuItemId: anyItemId, quantity: 1 }],
      },
    });
    assert.equal(servedOrder.status, 201, JSON.stringify(servedOrder.data));
    assert.equal(servedOrder.data.order.priority, "NORMAL");
    const servedId = servedOrder.data.order.id;

    const tooEarly = await api(`/orders/${servedId}/mark-served`, { method: "POST", token: cashier.token });
    assert.equal(tooEarly.status, 409, "serving an order that is not READY must be rejected");

    await api(`/orders/${servedId}/send-to-kitchen`, { method: "POST", token: cashier.token });
    const ticketList = await api<{ tickets: { id: string; orderId: string }[] }>("/kitchen/tickets", { token: admin.token });
    const myTickets = ticketList.data.tickets.filter((t) => t.orderId === servedId);
    assert.ok(myTickets.length >= 1, "expected kitchen tickets for the served-flow order");
    for (const tk of myTickets) {
      await api(`/kitchen/tickets/${tk.id}/status`, { method: "POST", token: admin.token, body: { status: "PREPARING" } });
      await api(`/kitchen/tickets/${tk.id}/status`, { method: "POST", token: admin.token, body: { status: "READY" } });
    }
    const readyOrder = await api<{ order: { status: string } }>(`/orders/${servedId}`, { token: cashier.token });
    assert.equal(readyOrder.data.order.status, "READY");

    const servedRes = await api<{ order: { status: string; servedAt: string | null; servedBy: string | null; lines: unknown[] } }>(
      `/orders/${servedId}/mark-served`,
      { method: "POST", token: cashier.token },
    );
    assert.equal(servedRes.status, 200, JSON.stringify(servedRes.data));
    assert.equal(servedRes.data.order.status, "SERVED");
    assert.ok(servedRes.data.order.servedAt);
    assert.ok(servedRes.data.order.servedBy);
    assert.ok(Array.isArray(servedRes.data.order.lines) && servedRes.data.order.lines.length > 0, "mark-served must return the hydrated order");
    const servedAgain = await api(`/orders/${servedId}/mark-served`, { method: "POST", token: cashier.token });
    assert.equal(servedAgain.status, 200, "mark-served must be idempotent");
    const openNow = await api<{ orders: { id: string }[] }>("/orders/open", { token: cashier.token });
    assert.ok(openNow.data.orders.some((o) => o.id === servedId), "SERVED order must stay recallable from the open list");
    if (availTable) {
      const session = await prisma.tableSession.findFirst({ where: { tableId: availTable.id, status: "OPEN" } });
      assert.ok(session?.servedAt, "dining session must record servedAt for turnover metrics");
    }
    ok("SERVED lifecycle: gated on READY, sets servedAt/servedBy, stays recallable");

    const prRush = await api<{ order: { priority: string } }>(`/orders/${servedId}/priority`, {
      method: "PATCH",
      token: admin.token,
      body: { priority: "RUSH" },
    });
    assert.equal(prRush.status, 200, JSON.stringify(prRush.data));
    assert.equal(prRush.data.order.priority, "RUSH");
    const prNoPin = await api(`/orders/${servedId}/priority`, { method: "PATCH", token: cashier.token, body: { priority: "VIP" } });
    assert.equal(prNoPin.status, 400, "cashier escalation without a manager PIN must be rejected");
    const prPin = await api<{ order: { priority: string } }>(`/orders/${servedId}/priority`, {
      method: "PATCH",
      token: cashier.token,
      body: { priority: "VIP", managerPin: PIN_OWNER },
    });
    assert.equal(prPin.status, 200, JSON.stringify(prPin.data));
    assert.equal(prPin.data.order.priority, "VIP");
    await api(`/orders/${servedId}/priority`, { method: "PATCH", token: cashier.token, body: { priority: "NORMAL" } });
    ok("kitchen priority: manager-PIN gated for cashiers and persists RUSH/VIP");

    // Cancelling every kitchen ticket must NOT mark the order ready/served:
    // a fully cancelled line-up means no food was cooked (regression guard).
    const cancelledFlow = await api<{ order: { id: string; total: string } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: { channel: "TAKEAWAY", items: [{ menuItemId: anyItemId, quantity: 1 }] },
    });
    assert.equal(cancelledFlow.status, 201, JSON.stringify(cancelledFlow.data));
    const cancelledId = cancelledFlow.data.order.id;
    await api(`/orders/${cancelledId}/send-to-kitchen`, { method: "POST", token: cashier.token });
    const cancelTickets = await api<{ tickets: { id: string; orderId: string }[] }>("/kitchen/tickets", { token: admin.token });
    for (const tk of cancelTickets.data.tickets.filter((t) => t.orderId === cancelledId)) {
      await api(`/kitchen/tickets/${tk.id}/status`, { method: "POST", token: admin.token, body: { status: "CANCELLED", reason: "verify cancel rollup" } });
    }
    const stillOpen = await api<{ order: { status: string } }>(`/orders/${cancelledId}`, { token: cashier.token });
    assert.equal(stillOpen.data.order.status, "SENT_TO_KITCHEN", "all tickets cancelled must not roll the order to READY/SERVED");
    await api(`/orders/${cancelledId}/cancel`, { method: "POST", token: admin.token, body: { reason: "cleanup after verify" } });
    ok("cancelling all kitchen tickets leaves the order unserved");

    // Settle the SERVED order (covers paying after service) and free the table.
    if (availTable) {
      const payServed = await api("/payments", {
        method: "POST",
        token: cashier.token,
        body: {
          orderId: servedId,
          shiftId: null,
          idempotencyKey: `served-flow-${servedId}`,
          payments: [{ method: "CASH", amount: Number(servedOrder.data.order.total) }],
        },
      });
      assert.equal(payServed.status, 201, JSON.stringify(payServed.data));
      await api(`/tables/${availTable.id}/clear`, { method: "POST", token: admin.token });
    } else {
      await api(`/orders/${servedId}/cancel`, { method: "POST", token: admin.token, body: { reason: "cleanup after verify" } });
    }

    const tablesAfterPay = await api<{ tables: { id: string; number: number; status: string }[] }>("/tables", { token: admin.token });
    const resTable =
      tablesAfterPay.data.tables.find((t) => t.id === availTable?.id && t.status === "AVAILABLE") ??
      tablesAfterPay.data.tables.find((t) => t.status === "AVAILABLE");
    assert.ok(resTable, "expected an available table for the reservation flow");
    const resStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const resEnd = new Date(resStart.getTime() + 3 * 60 * 60 * 1000);
    const newRes = await api<{ reservation: { id: string; status: string } }>("/reservations", {
      method: "POST",
      token: admin.token,
      body: { tableId: resTable.id, customerName: "Verify Guest", partySize: 4, reservationTime: resStart.toISOString() },
    });
    assert.equal(newRes.status, 201, JSON.stringify(newRes.data));
    assert.equal(newRes.data.reservation.status, "CONFIRMED");
    const resList = await api<{ reservations: { id: string }[] }>(
      `/reservations?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(resEnd.toISOString())}&tableId=${resTable.id}`,
      { token: admin.token },
    );
    assert.ok(resList.data.reservations.some((r) => r.id === newRes.data.reservation.id));
    const clash = await api("/reservations", {
      method: "POST",
      token: admin.token,
      body: {
        tableId: resTable.id,
        customerName: "Clash Guest",
        partySize: 2,
        reservationTime: new Date(resStart.getTime() + 30 * 60 * 1000).toISOString(),
      },
    });
    assert.equal(clash.status, 409, "overlapping reservation on the same table must be rejected");
    const seatRes = await api(`/reservations/${newRes.data.reservation.id}/seat`, { method: "POST", token: admin.token });
    assert.equal(seatRes.status, 200, JSON.stringify(seatRes.data));
    const seatedTable = await prisma.restaurantTable.findUnique({ where: { id: resTable.id } });
    assert.equal(seatedTable?.status, "OCCUPIED");
    const seatSession = await prisma.tableSession.findFirst({ where: { tableId: resTable.id, status: "OPEN" } });
    assert.ok(seatSession?.seatedAt, "seating a reservation must stamp the session seatedAt");
    const reseat = await api(`/reservations/${newRes.data.reservation.id}/seat`, { method: "POST", token: admin.token });
    assert.equal(reseat.status, 409, "re-seating a SEATED reservation must be rejected");
    await api(`/tables/${resTable.id}/clear`, { method: "POST", token: admin.token });
    const noShowRes = await api<{ reservation: { id: string } }>("/reservations", {
      method: "POST",
      token: admin.token,
      body: {
        tableId: resTable.id,
        customerName: "NoShow Guest",
        partySize: 2,
        reservationTime: new Date(resStart.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    const noShow = await api(`/reservations/${noShowRes.data.reservation.id}/no-show`, { method: "POST", token: admin.token });
    assert.equal(noShow.status, 200, JSON.stringify(noShow.data));
    await prisma.reservation.deleteMany({
      where: { restaurantId: restaurant.id, customerName: { in: ["Verify Guest", "Clash Guest", "NoShow Guest"] } },
    });
    ok("reservations create/conflict/list/seat with table + session timestamps");

    console.log(`\n\u2705 MegaDine Basic extended verification passed: ${passed} checks\n`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\n\u274c Extended verification FAILED\n", err);
  process.exit(1);
});
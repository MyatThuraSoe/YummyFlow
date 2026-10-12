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
import http from "node:http";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { initSocket } from "../src/lib/socket.js";
import { prisma } from "../src/lib/prisma.js";
import { businessDateFor } from "../src/lib/businessDay.js";

const PORT = 4598;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

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
    const cashier = await login("1111");
    const admin = await login("4444");

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
    assert.ok(rb.data.receipt.includes(`#${o.data.order.orderNumber}`), "receipt should include the order number");
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
    const withPin = await api(`/orders/${v2.data.order.id}/void-line`, { method: "POST", token: cashier.token, body: { lineId: v2.data.order.lines[0]!.id, reason: "verify-void", managerPin: "0000" } });
    assert.equal(withPin.status, 200);
    await api(`/orders/${v2.data.order.id}/cancel`, { method: "POST", token: cashier.token, body: { reason: "verify cleanup", managerPin: "0000" } });
    ok("manager PIN required (and works) to void a kitchen-sent line");

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
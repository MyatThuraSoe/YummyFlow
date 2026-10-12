/**
 * End-to-end verification of the MegaDine POS "Basic" exit gate.
 * Boots the real API against the seeded PostgreSQL database and walks the
 * full lifecycle: login → menu → order → kitchen → shift → payment → reports.
 *
 * Run:  npm run seed   (once, seeds demo data)
 *       npm run verify
 */
import "./_hermetic-env.js";
import http from "node:http";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { initSocket } from "../src/lib/socket.js";
import { prisma } from "../src/lib/prisma.js";

const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

// Demo PINs by default; override via PIN_<ROLE> (must match the seeded users).
const PIN_OWNER = process.env.PIN_OWNER ?? "0000";
const PIN_ADMIN = process.env.PIN_ADMIN ?? "4444";
const PIN_CASHIER = process.env.PIN_CASHIER ?? "1111";
const PIN_KITCHEN = process.env.PIN_KITCHEN ?? "3333";

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

async function login(pin: string): Promise<{ token: string; role: string }> {
  const { status, data } = await api<{ user: { role: string; capabilities: string[] }; token: string }>("/auth/login", {
    method: "POST",
    body: { pin },
  });
  assert.equal(status, 200, `login pin ${pin} failed: ${JSON.stringify(data)}`);
  return { token: data.token, role: data.user.role };
}

async function main() {
  const restaurant = await prisma.restaurant.findFirst();
  assert.ok(restaurant, "No restaurant found — run `npm run seed` first");

  const server = http.createServer(createApp());
  initSocket(server);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`\nMegaDine Basic verification against http://127.0.0.1:${PORT}\n`);

  try {
    // ── MEGA-0: auth + RBAC ─────────────────────────────
    const cashier = await login(PIN_CASHIER);
    assert.equal(cashier.role, "CASHIER");
    ok("PIN login resolves the CASHIER role");

    const kitchen = await login(PIN_KITCHEN);
    assert.equal(kitchen.role, "KITCHEN");
    ok("PIN login resolves the KITCHEN role");

    const admin = await login(PIN_ADMIN);
    assert.equal(admin.role, "ADMIN");
    ok("PIN login resolves the ADMIN role");

    const forbidden = await api("/admin/users", { token: cashier.token });
    assert.equal(forbidden.status, 403, "cashier must not read the staff list");
    ok("RBAC rejects unauthorized access with 403");

    const me = await api<{ user: { capabilities: string[] } }>("/auth/me", { token: cashier.token });
    assert.ok(me.data.user.capabilities.includes("pos.use"));
    ok("session returns capability matrix");

    // ── MEGA-1: menu + order + table ────────────────────
    const menu = await api<{ categories: { items: { id: string; name: string; price: string }[] }[] }>("/menu", { token: cashier.token });
    const items = menu.data.categories.flatMap((c) => c.items);
    assert.ok(items.length >= 5, "expected seeded menu items");
    const burger = items.find((i) => i.name === "Classic Burger")!;
    const coke = items.find((i) => i.name === "Coca-Cola")!;
    ok("menu returns seeded categories/items");

    const tables = await api<{ tables: { id: string; number: number; status: string }[] }>("/tables", { token: cashier.token });
    const table = tables.data.tables.find((t) => t.status === "AVAILABLE")!;
    assert.ok(table, "expected at least one available table");
    ok("floor plan lists tables");

    const orderKey = `verify-${Date.now()}`;
    const created = await api<{ order: { id: string; orderNumber: number; total: string } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: {
        channel: "DINE_IN",
        tableId: table.id,
        idempotencyKey: orderKey,
        items: [
          { menuItemId: burger.id, quantity: 2, modifierOptionIds: [] },
          { menuItemId: coke.id, quantity: 2 },
        ],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const orderId = created.data.order.id;
    const total = Number(created.data.order.total);
    assert.ok(total > 0, "order total must be positive");
    ok(`order created (#${created.data.order.orderNumber}, total ${total})`);

    // Idempotency: replaying the same key returns the same order, no duplicate.
    const replay = await api<{ order: { id: string } }>("/orders", {
      method: "POST",
      token: cashier.token,
      body: { channel: "DINE_IN", tableId: table.id, idempotencyKey: orderKey, items: [{ menuItemId: burger.id, quantity: 2 }] },
    });
    assert.equal(replay.data.order.id, orderId);
    ok("order creation is idempotent (duplicate key returns same order)");

    const afterCreate = await api<{ tables: { id: string; status: string }[] }>("/tables", { token: cashier.token });
    assert.equal(afterCreate.data.tables.find((t) => t.id === table.id)?.status, "OCCUPIED");
    ok("table flips to OCCUPIED on dine-in order");

    const sent = await api<{ tickets: number }>(`/orders/${orderId}/send-to-kitchen`, { method: "POST", token: cashier.token });
    assert.ok(sent.data.tickets >= 1, "expected at least one kitchen ticket");
    ok(`order routed to kitchen across ${sent.data.tickets} station ticket(s)`);

    // ── MEGA-1: KDS ─────────────────────────────────────
    const tickets = await api<{ tickets: { id: string; orderId: string; station: string; status: string }[] }>("/kitchen/tickets", { token: kitchen.token });
    const ticket = tickets.data.tickets.find((t) => t.orderId === orderId && t.status === "QUEUED");
    assert.ok(ticket, "expected a QUEUED ticket for the new order");
    const preparing = await api(`/kitchen/tickets/${ticket.id}/status`, { method: "POST", token: kitchen.token, body: { status: "PREPARING" } });
    assert.equal(preparing.status, 200);
    const ready = await api(`/kitchen/tickets/${ticket.id}/status`, { method: "POST", token: kitchen.token, body: { status: "READY" } });
    assert.equal(ready.status, 200);
    ok("KDS advances ticket QUEUED -> PREPARING -> READY");

    // ── MEGA-2: shift + payment ─────────────────────────
    const shift = await api<{ shift: { id: string } }>("/shifts/open", { method: "POST", token: cashier.token, body: { openingFloat: 100 } });
    assert.equal(shift.status, 201, JSON.stringify(shift.data));
    const shiftId = shift.data.shift.id;
    ok("cash shift opened with opening float");

    const cashReceived = Math.ceil(total / 10) * 10 + 10; // tender a round number above total
    const paid = await api<{ order: { paymentStatus: string; status: string; changeGiven: string } }>("/payments", {
      method: "POST",
      token: cashier.token,
      body: {
        orderId,
        shiftId,
        idempotencyKey: `pay-${orderId}`,
        payments: [{ method: "CASH", amount: total, cashReceived }],
      },
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.data));
    assert.equal(paid.data.order.paymentStatus, "SUCCEEDED");
    assert.equal(paid.data.order.status, "COMPLETED");
    assert.equal(Number(paid.data.order.changeGiven), Math.round((cashReceived - total) * 100) / 100);
    ok(`cash payment completes order; change ${paid.data.order.changeGiven} correct`);

    // Inventory theoretical consumption recorded.
    const movements = await prisma.stockMovement.count({ where: { reference: orderId, type: "SALE_CONSUMPTION" } });
    assert.ok(movements > 0, "expected ingredient consumption for the order");
    ok(`theoretical ingredient consumption recorded (${movements} movements)`);

    const xreport = await api<{ report: { expectedCash: number; cashSales: number } }>(`/shifts/${shiftId}/x-report`, { token: cashier.token });
    assert.equal(xreport.status, 200);
    assert.ok(xreport.data.report.cashSales >= Math.round(total * 100));
    ok("X-report reconciles cash sales");

    const closed = await api<{ variance: string }>(`/shifts/${shiftId}/close`, {
      method: "POST",
      token: cashier.token,
      body: { actualCash: 100 + total, notes: "verify" },
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    assert.equal(Number(closed.data.variance), 0);
    ok("shift closes with zero variance when drawer reconciles");

    // ── MEGA-3: reports + admin ─────────────────────────
    const daily = await api<{ report: { orderCount: number; netSales: number } }>("/reports/daily", { token: admin.token });
    assert.ok(daily.data.report.orderCount >= 1);
    ok("daily sales report reflects completed orders");

    const foodCost = await api<{ foodCostPercent: number }>("/reports/food-cost", { token: admin.token });
    assert.ok(foodCost.data.foodCostPercent >= 0);
    ok("food cost % report computes");

    // Refund needs a manager PIN and must be rejected without one.
    const noPin = await api("/payments/refund", { method: "POST", token: admin.token, body: { orderId, amount: 1, reason: "test" } });
    assert.equal(noPin.status, 400, "refund without manager PIN must be rejected");
    ok("refund without manager approval is rejected");

    const refund = await api<{ order: { paymentStatus: string } }>("/payments/refund", {
      method: "POST",
      token: admin.token,
      body: { orderId, amount: 2, reason: "customer complaint", managerPin: PIN_OWNER },
    });
    assert.equal(refund.status, 200, JSON.stringify(refund.data));
    assert.equal(refund.data.order.paymentStatus, "PARTIALLY_REFUNDED");
    ok("manager-PIN refund marks order PARTIALLY_REFUNDED");

    const auditCount = await prisma.auditLog.count({ where: { restaurantId: restaurant.id } });
    assert.ok(auditCount >= 5, "expected audit entries for the flow");
    ok(`audit log captured the session (${auditCount} entries)`);

    console.log(`\n\u2705 MegaDine Basic verification passed: ${passed} checks\n`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("\n\u274c Verification FAILED\n", err);
  process.exit(1);
});

import "../scripts/_hermetic-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRate, fromCents, round2, toCents } from "../src/lib/money.js";
import { computeOrderTotals, lineTotalCents, toDb } from "../src/lib/calculations.js";
import { addDays, businessDateFor, endOfDay, isSameDay, startOfDay } from "../src/lib/businessDay.js";
import { assertWithinLimit, getFeatures, getLimits } from "../src/lib/license.js";
import { expectedCash, varianceExceedsTolerance } from "../src/lib/cashVariance.js";
import { releaseUnique } from "../src/lib/userGuards.js";
import {
  overdueBand,
  pickOverdueTickets,
  pickReservationReminders,
} from "../src/services/notifications.service.js";

// ── money ───────────────────────────────────────────────
test("toCents rounds to nearest cent without float drift", () => {
  assert.equal(toCents(1.005), 100); // 1.005*100 = 100.4999...
  assert.equal(toCents("2.50"), 250);
  assert.equal(toCents(0), 0);
  assert.equal(toCents(-3.5), -350);
  assert.throws(() => toCents("abc"));
});

test("fromCents is the inverse of toCents for whole cents", () => {
  for (const c of [0, 1, 99, 100, 12345, -2550]) {
    assert.equal(toCents(fromCents(c)), c);
  }
  assert.equal(fromCents(12345), "123.45");
  assert.equal(fromCents(-2550), "-25.50");
});

test("applyRate multiplies cents by a decimal rate, rounding half-up", () => {
  assert.equal(applyRate(1000, 0.085), 85);
  assert.equal(applyRate(333, 0.1), 33);
  assert.equal(round2(1.005), 1.0);
});

// ── line totals ─────────────────────────────────────────
test("lineTotalCents includes modifiers and subtracts line discount", () => {
  const total = lineTotalCents({
    unitPrice: 10,
    quantity: 2,
    modifiers: [{ price: 1.5 }, { price: 0.5, quantity: 2 }],
    lineDiscount: 2,
  });
  // (1000 + 150 + 100) * 2 = 2500; − 200 = 2300
  assert.equal(total, 2300);
});

test("lineTotalCents never goes below zero", () => {
  assert.equal(lineTotalCents({ unitPrice: 5, quantity: 1, lineDiscount: 100 }), 0);
});

// ── order totals ────────────────────────────────────────
test("computeOrderTotals (tax-exclusive) adds service charge and tax", () => {
  const t = computeOrderTotals([1000, 2000], 0, { taxRate: 0.1, taxInclusive: false, serviceChargePct: 0.05 });
  assert.equal(t.subtotal, 3000);
  assert.equal(t.serviceCharge, 150);
  assert.equal(t.taxAmount, 315); // (3000+150)*0.1
  assert.equal(t.total, 3465);
});

test("computeOrderTotals applies order discount before tax", () => {
  const t = computeOrderTotals([1000, 1000], 500, { taxRate: 0, taxInclusive: false, serviceChargePct: 0 });
  assert.equal(t.subtotal, 2000);
  assert.equal(t.discountAmount, 500);
  assert.equal(t.total, 1500);
});

test("computeOrderTotals (tax-inclusive) reports embedded tax and keeps total", () => {
  const t = computeOrderTotals([1085], 0, { taxRate: 0.085, taxInclusive: true, serviceChargePct: 0 });
  assert.equal(t.total, 1085);
  assert.equal(t.taxAmount, 85); // 1085 * 0.085/1.085 ≈ 85
});

test("discount can never exceed subtotal", () => {
  const t = computeOrderTotals([500], 9999, { taxRate: 0, taxInclusive: false, serviceChargePct: 0 });
  assert.equal(t.discountAmount, 500);
  assert.equal(t.total, 0);
});

test("toDb formats cents back to fixed-precision strings", () => {
  const db = toDb({ subtotal: 1000, discountAmount: 0, serviceCharge: 0, taxAmount: 85, total: 1085 });
  assert.deepEqual(db, { subtotal: "10.00", discountAmount: "0.00", serviceCharge: "0.00", taxAmount: "0.85", total: "10.85" });
});

// ── business day ────────────────────────────────────────
test("sales after midnight but before cutoff belong to the previous business day", () => {
  const late = new Date(2026, 5, 11, 2, 30); // 11 Jun 02:30
  const bd = businessDateFor(late, "04:00");
  assert.equal(bd.getDate(), 10);
  assert.equal(bd.getHours(), 0);
});

test("sales after cutoff belong to the current business day", () => {
  const day = new Date(2026, 5, 11, 12, 0);
  const bd = businessDateFor(day, "04:00");
  assert.equal(bd.getDate(), 11);
});

test("exactly at cutoff rolls to the new business day", () => {
  const at = new Date(2026, 5, 11, 4, 0);
  assert.equal(businessDateFor(at, "04:00").getDate(), 11);
});

test("startOfDay/endOfDay/isSameDay/addDays behave as expected", () => {
  const d = new Date(2026, 0, 15, 13, 45, 30);
  assert.equal(startOfDay(d).getHours(), 0);
  assert.equal(endOfDay(d).getHours(), 23);
  assert.ok(isSameDay(startOfDay(d), d));
  assert.equal(addDays(d, 1).getDate(), 16);
});

// ── plan limits ─────────────────────────────────────────
test("no license key falls back to BASIC limits (2/15/50)", () => {
  const l = getLimits();
  assert.equal(l.edition, "BASIC");
  assert.equal(l.maxTerminals, 2);
  assert.equal(l.maxTables, 15);
  assert.equal(l.maxMenuItems, 50);
  assert.ok(getFeatures().includes("pos"));
});

test("assertWithinLimit allows below the cap and rejects at/over it", () => {
  assert.doesNotThrow(() => assertWithinLimit("tables", 14));
  assert.throws(() => assertWithinLimit("tables", 15), /Plan limit reached/);
  assert.throws(() => assertWithinLimit("terminals", 2));
  assert.throws(() => assertWithinLimit("menuItems", 50));
});

// ── cash variance (PRD platform §6) ─────────────────────
test("expectedCash combines float, cash sales, refunds and movements", () => {
  assert.equal(
    expectedCash({ openingFloat: 10_000, cashSales: 25_000, refundsInWindow: 3_000, paidIn: 1_000, paidOut: 2_000, safeDrops: 5_000 }),
    26_000,
  );
  assert.equal(
    expectedCash({ openingFloat: 0, cashSales: 0, refundsInWindow: 0, paidIn: 0, paidOut: 0, safeDrops: 0 }),
    0,
  );
});

test("variance tolerance boundary: strictly greater fails, equal passes", () => {
  assert.equal(varianceExceedsTolerance(500, 500), false);
  assert.equal(varianceExceedsTolerance(-500, 500), false);
  assert.equal(varianceExceedsTolerance(501, 500), true);
  assert.equal(varianceExceedsTolerance(-501, 500), true);
});

test("PRD §6.8 worked example: a cross-shift refund drives the drawer expectation negative", () => {
  const expected = expectedCash({ openingFloat: 0, cashSales: 0, refundsInWindow: 10_000, paidIn: 0, paidOut: 0, safeDrops: 0 });
  assert.equal(expected, -10_000);
  assert.equal(0 - expected, 10_000);
});

// ── user guards (PRD platform §5.3) ─────────────────────
test("releaseUnique appends a deletion suffix and respects max length", () => {
  assert.equal(releaseUnique(null, "abcdef123456"), null);
  assert.equal(releaseUnique("cashier", "abcdef123456"), "cashier#del-abcdef12");
  const freed = releaseUnique("u".repeat(400), "12345678", 255)!;
  assert.equal(freed, "u".repeat(242) + "#del-12345678");
  assert.equal(freed.length, 255);
  assert.equal(releaseUnique("ab", "12345678", 10), "#del-12345678");
});

// ── kitchen notifications (Phase 2) ─────────────────────────────────────────
test("overdueBand escalates at 15 and 30 minutes", () => {
  assert.equal(overdueBand(0), null);
  assert.equal(overdueBand(14), null);
  assert.equal(overdueBand(15), "warn");
  assert.equal(overdueBand(29), "warn");
  assert.equal(overdueBand(30), "overdue");
  assert.equal(overdueBand(90), "overdue");
});

test("pickOverdueTickets notifies once per band and re-notifies on escalation", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const seen = new Map<string, string>();
  const ticket = (sentAtIso: string) => ({ id: "t1", orderNumber: 7, station: "GRILL", sentAt: new Date(sentAtIso) });

  const fresh = pickOverdueTickets(now, [ticket("2026-10-19T11:50:00Z")], seen);
  assert.equal(fresh.length, 0, "10 minutes old is not overdue yet");

  const warn = pickOverdueTickets(now, [ticket("2026-10-19T11:44:00Z")], seen);
  assert.deepEqual(warn.map((n) => n.band), ["warn"]);
  assert.equal(warn[0].minutes, 16);
  assert.equal(pickOverdueTickets(now, [ticket("2026-10-19T11:44:00Z")], seen).length, 0, "same band must not re-notify");

  const escalate = pickOverdueTickets(now, [ticket("2026-10-19T11:29:00Z")], seen);
  assert.deepEqual(escalate.map((n) => n.band), ["overdue"]);
});

test("pickReservationReminders fires once inside the 15 minute window", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const reminded = new Set<string>();
  const res = (id: string, minutesAhead: number) => ({
    id,
    customerName: `Guest ${id}`,
    partySize: 4,
    tableNumber: 5,
    reservationTime: new Date(now.getTime() + minutesAhead * 60000),
  });

  const due = pickReservationReminders(now, [res("past", -5), res("soon", 10), res("later", 45)], reminded);
  assert.deepEqual(due.map((n) => n.reservationId), ["soon"]);
  assert.equal(due[0].minutesUntil, 10);
  assert.equal(pickReservationReminders(now, [res("soon", 10)], reminded).length, 0, "must not re-notify");

  const boundary = pickReservationReminders(now, [res("edge", 15)], new Set());
  assert.deepEqual(boundary.map((n) => n.reservationId), ["edge"]);
});

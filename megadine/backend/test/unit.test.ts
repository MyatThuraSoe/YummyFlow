import "../scripts/_hermetic-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRate, fromCents, round2, toCents } from "../src/lib/money.js";
import { computeOrderTotals, lineTotalCents, toDb } from "../src/lib/calculations.js";
import { addDays, businessDateFor, endOfDay, isSameDay, startOfDay } from "../src/lib/businessDay.js";
import { assertWithinLimit, getFeatures, getLimits } from "../src/lib/license.js";

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

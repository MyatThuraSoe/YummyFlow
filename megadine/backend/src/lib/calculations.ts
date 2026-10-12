import { applyRate, toCents, fromCents } from "./money.js";

export interface LineInput {
  unitPrice: number | string; // per-unit price (pre-modifier)
  quantity: number;
  modifiers?: { price: number | string; quantity?: number }[];
  lineDiscount?: number | string; // absolute amount for the whole line
}

export interface OrderTotals {
  subtotal: number; // cents
  discountAmount: number; // cents
  serviceCharge: number; // cents
  taxAmount: number; // cents
  total: number; // cents
}

/** Total for a single line, in cents: (unit + Σ modifier) * qty − discount. */
export function lineTotalCents(line: LineInput): number {
  const unit = toCents(line.unitPrice);
  const mods = (line.modifiers ?? []).reduce(
    (sum, m) => sum + toCents(m.price) * (m.quantity ?? 1),
    0,
  );
  const gross = (unit + mods) * line.quantity;
  const discount = line.lineDiscount ? toCents(line.lineDiscount) : 0;
  return Math.max(0, gross - discount);
}

export interface TotalsConfig {
  taxRate: number; // e.g. 0.085
  taxInclusive: boolean;
  serviceChargePct: number; // e.g. 0.1
}

/**
 * Order-level totals. Input lines must already include per-line discounts.
 * `orderDiscount` is an absolute amount applied after subtotal.
 */
export function computeOrderTotals(
  lineTotals: number[],
  orderDiscount: number,
  cfg: TotalsConfig,
): OrderTotals {
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const discountAmount = Math.min(orderDiscount, subtotal);
  const taxableBase = subtotal - discountAmount;
  const serviceCharge = applyRate(taxableBase, cfg.serviceChargePct);

  let taxAmount: number;
  let total: number;
  if (cfg.taxInclusive) {
    // Prices already contain tax; report the embedded tax for the receipt.
    const gross = taxableBase + serviceCharge;
    taxAmount = applyRate(gross, cfg.taxRate / (1 + cfg.taxRate));
    total = gross;
  } else {
    taxAmount = applyRate(taxableBase + serviceCharge, cfg.taxRate);
    total = taxableBase + serviceCharge + taxAmount;
  }

  return { subtotal, discountAmount, serviceCharge, taxAmount, total };
}

export function toDb(t: OrderTotals) {
  return {
    subtotal: fromCents(t.subtotal),
    discountAmount: fromCents(t.discountAmount),
    serviceCharge: fromCents(t.serviceCharge),
    taxAmount: fromCents(t.taxAmount),
    total: fromCents(t.total),
  };
}

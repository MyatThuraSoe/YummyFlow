export const CURRENCY = import.meta.env.VITE_CURRENCY || "USD";

const SYMBOLS: Record<string, string> = { USD: "$", THB: "\u0e3f", MMK: "K", CNY: "\u00a5" };

export function toCents(v: number | string): number {
  return Math.round(Number(v) * 100);
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatMoney(cents: number, currency = CURRENCY): string {
  return `${SYMBOLS[currency] ?? ""}${fromCents(cents)}`;
}

export interface TotalsConfig {
  taxRate: number;
  taxInclusive: boolean;
  serviceChargePct: number;
}

export function computeTotals(lineTotals: number[], orderDiscountCents: number, cfg: TotalsConfig) {
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const discountAmount = Math.min(orderDiscountCents, subtotal);
  const taxableBase = subtotal - discountAmount;
  const serviceCharge = Math.round(taxableBase * cfg.serviceChargePct);
  let taxAmount: number;
  let total: number;
  if (cfg.taxInclusive) {
    const gross = taxableBase + serviceCharge;
    taxAmount = Math.round(gross * (cfg.taxRate / (1 + cfg.taxRate)));
    total = gross;
  } else {
    taxAmount = Math.round((taxableBase + serviceCharge) * cfg.taxRate);
    total = taxableBase + serviceCharge + taxAmount;
  }
  return { subtotal, discountAmount, serviceCharge, taxAmount, total };
}

/**
 * Money is handled as integer minor units (cents) everywhere internally.
 * Decimal columns are written back as fixed-precision strings to avoid
 * floating-point drift. See PRD OG-2 — no float math on currency.
 */

export function toCents(value: number | string | { toString(): string }): number {
  const s = typeof value === "number" ? value.toString() : value.toString();
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid money value: ${s}`);
  return Math.round(n * 100);
}

const CURRENCY_DECIMALS: Record<string, number> = {
  MMK: 0, KHR: 0, JPY: 0, VND: 0,
  USD: 2, THB: 2, CNY: 2, EUR: 2, GBP: 2,
};

export function currencyDecimals(currency = "USD"): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

export function fromCents(cents: number, decimals = 2): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const factor = Math.pow(10, decimals);
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  return `${sign}${whole}.${String(frac).padStart(decimals, "0")}`;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Multiply a money amount (in cents) by a decimal factor, rounding half-up. */
export function applyRate(cents: number, rate: number): number {
  return Math.round(cents * rate);
}
export function roundCash(cents: number, step: number): number {
  if (!step || step <= 0) return cents;
  return Math.round(cents / step) * step;
}

export function formatMoney(cents: number, currency = "USD"): string {
  const decimals = currencyDecimals(currency);
  const symbols: Record<string, string> = { USD: "$", THB: "฿", MMK: "K", CNY: "¥", EUR: "€", GBP: "£", JPY: "¥" };
  const sym = symbols[currency.toUpperCase()] ?? "";
  return `${sym}${fromCents(cents, decimals)}`;
}

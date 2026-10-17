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

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Multiply a money amount (in cents) by a decimal factor, rounding half-up. */
export function applyRate(cents: number, rate: number): number {
  return Math.round(cents * rate);
}

export function formatMoney(cents: number, currency = "USD"): string {
  const symbols: Record<string, string> = { USD: "$", THB: "฿", MMK: "K", CNY: "¥" };
  const sym = symbols[currency] ?? "";
  return `${sym}${fromCents(cents)}`;
}

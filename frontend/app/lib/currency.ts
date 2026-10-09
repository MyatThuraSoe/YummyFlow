/**
 * Currency registry (frontend mirror of backend/src/lib/currency.ts).
 *
 * Backend is the source of truth: `backend/.env` sets `CURRENCY`, and every
 * stored amount is a bare Float in that one currency. This module mirrors the
 * registry so the UI renders the SAME symbol/locale, and reads the active
 * code from `VITE_CURRENCY`. The two env values must match — exactly like
 * `VITE_VAPID_PUBLIC_KEY` must equal the backend's `VAPID_PUBLIC_KEY`.
 *
 * Do not hardcode `$` in a component; import `formatMoney` instead.
 */

export type CurrencyCode = "USD" | "THB" | "MMK" | "CNY";

export type CurrencyDefinition = {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimals: number;
};

export const CURRENCIES: Record<CurrencyCode, CurrencyDefinition> = {
  USD: { code: "USD", symbol: "$", name: "US Dollar", decimals: 2 },
  THB: { code: "THB", symbol: "฿", name: "Thai Baht", decimals: 2 },
  MMK: { code: "MMK", symbol: "Ks", name: "Myanmar Kyat", decimals: 2 },
  CNY: { code: "CNY", symbol: "¥", name: "Chinese Yuan", decimals: 2 },
};

const DEFAULT_CURRENCY: CurrencyCode = "USD";

export const isCurrencyCode = (value: unknown): value is CurrencyCode =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(CURRENCIES, value.toUpperCase());

export const resolveCurrency = (value: unknown): CurrencyCode => {
  if (typeof value !== "string") return DEFAULT_CURRENCY;
  const upper = value.trim().toUpperCase();
  return isCurrencyCode(upper) ? upper : DEFAULT_CURRENCY;
};

/** The ONE currency this deployment quotes in. Set via VITE_CURRENCY. */
export const ACTIVE_CURRENCY: CurrencyCode = resolveCurrency(
  import.meta.env.VITE_CURRENCY,
);

/**
 * Formats an amount for display.
 *
 * Same rules as the backend helper: symbol from the registry, grouping and
 * decimals from `Intl.NumberFormat`, locale fixed to en-US so a restaurant
 * quoting MMK still reads "Ks 1,200.00" for its English-speaking staff.
 */
export const formatMoney = (
  amount: number,
  options: { compact?: boolean; showSymbol?: boolean; code?: CurrencyCode } = {},
): string => {
  const { compact = false, showSymbol = true } = options;
  const currency = CURRENCIES[options.code ?? ACTIVE_CURRENCY];

  if (compact) {
    return `${showSymbol ? currency.symbol : ""}${new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount)}`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.code,
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  }).format(amount);
};
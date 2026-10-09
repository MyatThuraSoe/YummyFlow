/**
 * Currency registry.
 *
 * Single source of truth for every currency the app can charge or display in.
 * Prices are stored as bare `Float`s (`menuItem.price`, `Order.totalAmount`,
 * `OrderItem.price`) with no currency attached, so every place that turns a
 * number into money text has to agree on which currency that number is in.
 * Before this existed that agreement was implicit and wrong: the dashboard,
 * the charts and the menu cards each hardcoded `$` independently, so switching
 * currency meant hunting down string literals.
 *
 * The canonical code is the ISO 4217 uppercase form (`USD`, `THB`, `MMK`,
 * `CNY`), which is also the form `Intl.NumberFormat` expects.
 *
 * There is exactly ONE currency per deployment (`ACTIVE_CURRENCY`, below).
 * Amounts are stored unlabelled on purpose; the whole app quotes in the same
 * currency, so a stored `1200` always means the same thing.
 */

export type CurrencyCode = "USD" | "THB" | "MMK" | "CNY";

export type CurrencyDefinition = {
  /** ISO 4217 code, uppercase. Use this everywhere in our own code and storage. */
  code: CurrencyCode;
  /** Symbol shown next to amounts. */
  symbol: string;
  /** Name for the settings dropdown. */
  name: string;
  /**
   * How many decimal places this currency is quoted in, and therefore how many
   * minor units make up one major unit.
   *
   * This exists because `Math.round(price * 100)` is NOT universally right.
   * Most currencies are 2-decimal, but a set of them (JPY, KRW, VND and
   * others) are zero-decimal, where 1000 yen is `1000` and NOT `100000`.
   * Encoding the exponent as data means adding a currency later is a one-line
   * change instead of an audit of every `* 100` in the codebase.
   *
   * The four currencies below are all quoted in two decimals. `decimals` is
   * carried per-currency rather than assumed globally so that adding a
   * zero-decimal currency cannot silently misprice every order by 100x.
   */
  decimals: number;
};

export const CURRENCIES: Record<CurrencyCode, CurrencyDefinition> = {
  USD: {
    code: "USD",
    symbol: "$",
    name: "US Dollar",
    decimals: 2,
  },
  THB: {
    code: "THB",
    symbol: "฿",
    name: "Thai Baht",
    decimals: 2,
  },
  MMK: {
    code: "MMK",
    symbol: "Ks",
    name: "Myanmar Kyat",
    decimals: 2,
  },
  CNY: {
    code: "CNY",
    symbol: "¥",
    name: "Chinese Yuan",
    decimals: 2,
  },
};

export const SUPPORTED_CURRENCIES: CurrencyDefinition[] = Object.values(
  CURRENCIES,
);

export const DEFAULT_CURRENCY: CurrencyCode = "USD";

export const isCurrencyCode = (value: unknown): value is CurrencyCode =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(CURRENCIES, value.toUpperCase());

/**
 * Normalises anything user- or env-supplied into a known code, falling back to
 * USD rather than throwing.
 *
 * Deliberately lenient: this is fed from env vars and a settings form, and a
 * bad value there should degrade to a working app rather than a boot loop.
 */
export const resolveCurrency = (value: unknown): CurrencyCode => {
  if (typeof value !== "string") return DEFAULT_CURRENCY;
  const upper = value.trim().toUpperCase();
  return isCurrencyCode(upper) ? upper : DEFAULT_CURRENCY;
};

/**
 * Formats an amount for display.
 *
 * Thin wrapper over `Intl.NumberFormat` so the browser handles grouping and
 * decimal placement rather than us string-building `${value.toFixed(2)}` in a
 * dozen components. Locale is deliberately NOT derived from the currency:
 * a restaurant may quote in MMK while its staff read English, and the
 * important part to a customer is the symbol, not the digit grouping.
 */
export const formatMoney = (
  amount: number,
  code: CurrencyCode = DEFAULT_CURRENCY,
  options: { compact?: boolean; showSymbol?: boolean } = {},
): string => {
  const { compact = false, showSymbol = true } = options;
  const currency = CURRENCIES[code];

  // Compact form for chart axes, where "$1.2M" is readable and "$1,234,567.00"
  // is not.
  if (compact) {
    return `${showSymbol ? currency.symbol : ""}${new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount)}`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  }).format(amount);
};

/**
 * The currency this deployment is operating in.
 *
 * Read from the environment rather than the database because it has to be
 * available before any request is served — including on the very first
 * request, which may be the one that reads the menu. A per-restaurant
 * database setting would be the natural next step if this ever becomes
 * multi-tenant; see the note in CURRENCIES about stored amounts carrying no
 * currency of their own.
 */
export const ACTIVE_CURRENCY: CurrencyCode = resolveCurrency(
  process.env.CURRENCY,
);

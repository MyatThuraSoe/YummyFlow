/**
 * Helpers for dates that travel through `$runCommandRaw` pipelines.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `$runCommandRaw` sends the command document as extended JSON and does NOT
 * convert a JS `Date` into a BSON date — the value arrives at the server as a
 * plain string. A pipeline containing
 *
 *     { createdAt: { $gte: new Date() } }
 *
 * therefore matches NOTHING. It does not error, it does not warn, it just
 * returns an empty result — which renders as a dashboard or a day-close report
 * full of confident zeros. That failure mode is expensive to debug because
 * every layer reports success.
 *
 * Any date destined for a raw pipeline must be wrapped in `bsonDate()`.
 * Keeping it here (rather than in one controller) means the next person writing
 * an aggregation has an obvious correct thing to reach for.
 */

/** Wrap a JS `Date` so a raw aggregation pipeline compares it as a BSON date. */
export const bsonDate = (d: Date) => ({ $date: d.toISOString() });

/**
 * Midnight UTC of the calendar day containing `from`.
 *
 * The aggregation pipelines group with `$dateToString` on the stored UTC
 * instant, so the windows have to be cut in UTC too. Cutting with the local
 * `setDate()` and then zeroing UTC hours can land on the wrong day whenever the
 * local clock is behind UTC — the bucket and its label drift apart by one.
 */
export const utcStartOfDay = (from: Date) => {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/** Midnight UTC `days` before `from`. */
export const utcStartOfDaysAgo = (from: Date, days: number) => {
  const d = utcStartOfDay(from);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
};

/** `YYYY-MM-DD` in UTC — the key shape `$dateToString` produces. */
export const utcDayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Add whole days to a UTC instant without mutating the input. */
export const addUtcDays = (from: Date, days: number) => {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

/**
 * Parse a `YYYY-MM-DD` query parameter into a UTC day window `[start, end)`.
 *
 * Returns `null` for anything unparseable so the caller can answer 400 rather
 * than silently reporting on the wrong day.
 */
export function parseUtcDayWindow(raw?: unknown) {
  if (raw !== undefined && typeof raw !== "string") return null;

  const start = raw
    ? new Date(`${raw}T00:00:00.000Z`)
    : utcStartOfDay(new Date());

  // `new Date("garbageT00:00:00.000Z")` yields an Invalid Date, and a bare
  // "2026-13-45" normalises into a different month rather than failing — so
  // verify the round trip instead of trusting the parser.
  if (Number.isNaN(start.getTime())) return null;
  if (raw && utcDayKey(start) !== raw) return null;

  return { start, end: addUtcDays(start, 1) };
}

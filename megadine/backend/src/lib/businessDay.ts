/**
 * Business day logic: a restaurant "day" rolls over at the configured cutoff
 * (default 04:00) in the restaurant's own time zone, so late-night sales belong
 * to the previous calendar day.
 *
 * Business dates are stored as UTC midnight of the restaurant-local calendar
 * date (a date-only value). Using UTC accessors everywhere keeps those dates
 * stable no matter which zone the server or container runs in. See PRD §5.
 */

function parseCutoff(cutoff: string): { h: number; m: number } {
  const [h, m] = cutoff.split(":").map((x) => parseInt(x, 10));
  return { h: h || 0, m: m || 0 };
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const SERVER_ZONE = (() => {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(resolved) ? resolved : "UTC";
})();

/** The restaurant's IANA zone, configured at boot (and on settings change). */
let configuredZone: string | null = null;

export function setBusinessTimezone(tz: string | null | undefined): void {
  configuredZone = isValidTimeZone(tz) ? tz : null;
}

export function getBusinessTimezone(): string {
  if (configuredZone) return configuredZone;
  if (isValidTimeZone(process.env.TZ)) return process.env.TZ;
  return SERVER_ZONE;
}

interface ZonedParts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
}

/** Wall-clock parts of an instant in a zone (month/day are 1-based). */
export function zonedParts(instant: Date, timezone = getBusinessTimezone()): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year ?? 0, m: p.month ?? 1, d: p.day ?? 1, h: p.hour === 24 ? 0 : (p.hour ?? 0), min: p.minute ?? 0, s: p.second ?? 0 };
}

/** Offset (ms) of a zone from UTC at a given instant: localWallClock - utc. */
function zoneOffsetMs(timezone: string, instant: Date): number {
  const p = zonedParts(instant, timezone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in a zone to the corresponding UTC instant. */
export function zonedTimeToUtc(timezone: string, y: number, m: number, d: number, h: number, min: number): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = zoneOffsetMs(timezone, new Date(guess));
  let ts = guess - first;
  // Refine once so DST transitions resolve to the correct side.
  const second = zoneOffsetMs(timezone, new Date(ts));
  if (second !== first) ts = guess - second;
  return new Date(ts);
}

/** Returns the business date (a Date at UTC midnight) for an instant. */
export function businessDateFor(instant: Date, cutoff = "04:00", timezone?: string): Date {
  const tz = timezone ?? getBusinessTimezone();
  const { h, m } = parseCutoff(cutoff);
  const p = zonedParts(instant, tz);
  let y = p.y;
  let mo = p.m;
  let d = p.d;
  if (p.h < h || (p.h === h && p.min < m)) {
    const prev = new Date(Date.UTC(y, mo - 1, d));
    prev.setUTCDate(prev.getUTCDate() - 1);
    y = prev.getUTCFullYear();
    mo = prev.getUTCMonth() + 1;
    d = prev.getUTCDate();
  }
  return new Date(Date.UTC(y, mo - 1, d));
}

/** Midnight (UTC) of the same date-only value. */
export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function endOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** `YYYY-MM-DD` for a date-only business date (or any instant's UTC date). */
export function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** `YYYY-MM-DD` of the calendar date an instant falls on in a zone. */
export function localDateKey(instant: Date, timezone = getBusinessTimezone()): string {
  const p = zonedParts(instant, timezone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

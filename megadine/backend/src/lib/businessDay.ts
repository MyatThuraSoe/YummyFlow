/**
 * Business day logic: a restaurant "day" rolls over at the configured cutoff
 * (default 04:00), so late-night sales belong to the previous calendar day.
 * See PRD §5 business-date rule.
 */

function parseCutoff(cutoff: string): { h: number; m: number } {
  const [h, m] = cutoff.split(":").map((x) => parseInt(x, 10));
  return { h: h || 0, m: m || 0 };
}

/** Returns the business date (as a Date at 00:00 local) for a given instant. */
export function businessDateFor(instant: Date, cutoff = "04:00", tzOffsetMinutes?: number): Date {
  const { h, m } = parseCutoff(cutoff);
  // Shift the instant back by the cutoff, then take the calendar day.
  const shifted = new Date(instant.getTime());
  if (tzOffsetMinutes !== undefined) {
    shifted.setTime(shifted.getTime() + tzOffsetMinutes * 60_000);
  }
  const beforeCutoff =
    shifted.getHours() < h || (shifted.getHours() === h && shifted.getMinutes() < m);
  const day = new Date(shifted);
  day.setHours(0, 0, 0, 0);
  if (beforeCutoff) day.setDate(day.getDate() - 1);
  return day;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Shared helpers for the live operational screens (kitchen board, floor plan).
 */

/** Whole minutes since an ISO timestamp, never negative. */
export function elapsedMinutes(createdAt: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
}

/** Compact duration for a badge: `7m`, `1h 12m`. */
export function formatElapsed(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Short, speakable reference for an order.
 *
 * Order ids are 24-character ObjectIds. Staff need something they can call
 * across the kitchen, so the last six characters become the ticket code.
 */
export function ticketCode(id: string) {
  return id.slice(-6).toUpperCase();
}

/**
 * Urgency band for an elapsed duration.
 *
 * Used to colour-code tickets and occupied tables so the pass and the host desk
 * can spot something that has been sitting too long at a glance.
 */
export type Urgency = "normal" | "warn" | "late";

export function urgencyOf(
  minutes: number,
  warnAt = 5,
  lateAt = 10,
): Urgency {
  if (minutes >= lateAt) return "late";
  if (minutes >= warnAt) return "warn";
  return "normal";
}

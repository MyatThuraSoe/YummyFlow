/**
 * Pure helpers for line-level refunds. Amounts are integer cents.
 */

export interface RefundLineSelection {
  lineId: string;
  quantity: number;
}

export interface RefundedLineSnapshot {
  lineId: string;
  quantity: number;
  amountCents: number;
}

export interface RefundableLine {
  id: string;
  quantity: number;
  lineTotalCents: number;
}

/**
 * Refund amount for `quantity` units of a line with `lineQuantity` units and
 * a net (post line-discount) total of `lineTotalCents`. Rounded to whole
 * cents per line so partial refunds add up predictably.
 */
export function computeLineRefundAmount(lineTotalCents: number, lineQuantity: number, quantity: number): number {
  if (lineQuantity <= 0 || quantity <= 0) return 0;
  return Math.round((lineTotalCents * quantity) / lineQuantity);
}

/** Sum previously refunded quantities per line from `Refund.refundedLines` JSON. */
export function priorRefundedQtyByLine(refundedLines: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(refundedLines)) return map;
  for (const entry of refundedLines) {
    if (!entry || typeof entry !== "object") continue;
    const { lineId, quantity } = entry as { lineId?: unknown; quantity?: unknown };
    if (typeof lineId !== "string" || typeof quantity !== "number" || !Number.isFinite(quantity)) continue;
    map.set(lineId, (map.get(lineId) ?? 0) + quantity);
  }
  return map;
}

/**
 * Validate a line-level refund request against the order's lines and prior
 * refunds. Throws nothing; returns per-line snapshots plus the total amount.
 */
export function planLineRefund(
  lines: RefundableLine[],
  priorRefunded: Map<string, number>,
  selections: RefundLineSelection[],
): { ok: true; snapshot: RefundedLineSnapshot[]; amountCents: number } | { ok: false; message: string } {
  const snapshot: RefundedLineSnapshot[] = [];
  let amountCents = 0;
  for (const sel of selections) {
    const line = lines.find((l) => l.id === sel.lineId);
    if (!line) return { ok: false, message: `Line ${sel.lineId} is not part of this order` };
    const remaining = line.quantity - (priorRefunded.get(sel.lineId) ?? 0);
    if (sel.quantity > remaining) {
      return { ok: false, message: `Refund quantity exceeds the ${remaining} remaining unit(s) on the line` };
    }
    const lineAmount = computeLineRefundAmount(line.lineTotalCents, line.quantity, sel.quantity);
    snapshot.push({ lineId: sel.lineId, quantity: sel.quantity, amountCents: lineAmount });
    amountCents += lineAmount;
  }
  return { ok: true, snapshot, amountCents };
}

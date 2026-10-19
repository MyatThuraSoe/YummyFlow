/**
 * Pure cash-reconciliation math (PRD platform §6). All amounts in integer cents.
 *
 * expectedCash = openingFloat + cashSales − refundsInWindow + paidIn − paidOut − safeDrops
 */
export interface CashVarianceInput {
  openingFloat: number;
  cashSales: number;
  refundsInWindow: number;
  paidIn: number;
  paidOut: number;
  safeDrops: number;
}

export function expectedCash(i: CashVarianceInput): number {
  return i.openingFloat + i.cashSales - i.refundsInWindow + i.paidIn - i.paidOut - i.safeDrops;
}

/**
 * True when |variance| is strictly greater than the tolerance. The boundary
 * (abs(variance) === tolerance) is considered within tolerance (PRD §6.4).
 */
export function varianceExceedsTolerance(varianceCents: number, toleranceCents: number): boolean {
  return Math.abs(varianceCents) > toleranceCents;
}

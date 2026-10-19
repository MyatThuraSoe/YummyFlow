/**
 * Pure math for "split bill by person": distributes order-level discount,
 * service charge and tax across person groups proportionally to each group's
 * line subtotal. All amounts are integer cents so totals always reconcile.
 */

export interface SplitTotalsCents {
  subtotal: number;
  discountAmount: number;
  serviceCharge: number;
  taxAmount: number;
}

export interface SplitShare {
  subtotal: number;
  discount: number;
  serviceCharge: number;
  tax: number;
  total: number;
}

/**
 * Proportional shares with the rounding remainder assigned to the largest
 * group, so the shares of every component sum exactly to the order value.
 */
export function computeSplitShares(totals: SplitTotalsCents, groupSubtotals: number[]): SplitShare[] {
  const base = groupSubtotals.reduce((s, v) => s + v, 0);

  const distribute = (amount: number): number[] => {
    if (base <= 0 || amount === 0) return groupSubtotals.map(() => 0);
    const shares = groupSubtotals.map((sub) => Math.round((amount * sub) / base));
    const drift = amount - shares.reduce((s, v) => s + v, 0);
    if (drift !== 0) {
      let largest = 0;
      for (let i = 1; i < groupSubtotals.length; i += 1) {
        if ((groupSubtotals[i] ?? 0) > (groupSubtotals[largest] ?? 0)) largest = i;
      }
      shares[largest] = (shares[largest] ?? 0) + drift;
    }
    return shares;
  };

  const discounts = distribute(totals.discountAmount);
  const services = distribute(totals.serviceCharge);
  const taxes = distribute(totals.taxAmount);

  return groupSubtotals.map((sub, i) => {
    const discount = discounts[i] ?? 0;
    const service = services[i] ?? 0;
    const tax = taxes[i] ?? 0;
    return {
      subtotal: sub,
      discount,
      serviceCharge: service,
      tax,
      total: sub - discount + service + tax,
    };
  });
}

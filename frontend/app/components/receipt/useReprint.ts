import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { getOrderReceipt } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { usePrint, type ReceiptData } from "./Receipt";

/**
 * Reprint a receipt for an order that already exists.
 *
 * The kitchen and till boards deliberately omit per-line prices so the payload
 * they refresh every few seconds stays small — which means they cannot render a
 * full chit from what they already hold. Rather than fattening that payload for
 * an action that happens a handful of times a shift, this fetches the one order
 * on demand and lets React Query cache it, so reprinting the same chit twice
 * costs one request.
 *
 * Usage: call `reprint(orderId)`, then render
 * `{receiptData && <Receipt ref={receiptRef} data={receiptData} />}` once.
 */
export function useReprint() {
  const queryClient = useQueryClient();
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  /** Which order is currently being fetched, so only that row shows a spinner. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const { receiptRef, print } = usePrint({
    documentTitle: () => `Receipt-${receiptData?.orderId ?? "DineFlow"}`,
    onAfterPrint: () => setReceiptData(null),
  });

  const reprint = useCallback(
    async (orderId: string) => {
      setBusyId(orderId);
      try {
        const order = await queryClient.fetchQuery({
          queryKey: qk.orders.receipt(orderId),
          queryFn: () => getOrderReceipt(orderId),
        });

        setReceiptData({
          orderId: order.id,
          createdAt: order.createdAt,
          orderType: order.orderType,
          tableName: order.table?.name ?? null,
          paymentMethod: order.paymentMethod,
          total: order.totalAmount,
          lines: order.items.map((item) => ({
            name: item.menuItem.name,
            quantity: item.quantity,
            unitPrice: item.price,
            notes: item.notes,
          })),
        });

        // One tick for React to commit the lines — cloning the iframe before
        // that would print the previous receipt.
        setTimeout(() => print(), 100);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not load the receipt",
        );
      } finally {
        setBusyId(null);
      }
    },
    [queryClient, print],
  );

  return { reprint, busyId, receiptRef, receiptData };
}

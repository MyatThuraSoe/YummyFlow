import { forwardRef, useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";

/**
 * The 80mm thermal receipt.
 *
 * Extracted from `OrderSummary`, where it was inlined, because three places now
 * need the same chit: the till prints one after a sale, the Active Orders board
 * reprints one on request, and order history reprints an old one.
 *
 * NOTE: this block is deliberately hard-coded black-on-white rather than using
 * the theme tokens. It is printed onto paper — following dark mode here would
 * produce a receipt that drains a roll of ink for no reason.
 */

export type ReceiptLine = {
  name: string;
  quantity: number;
  /** Unit price at the time of sale, not today's menu price. */
  unitPrice: number;
  notes?: string | null;
};

export type ReceiptData = {
  orderId: string;
  createdAt?: string | Date | null;
  orderType?: string | null;
  tableName?: string | null;
  paymentMethod?: string | null;
  total?: number | null;
  lines: ReceiptLine[];
};

/** "DINE_IN" → "DINE IN", so the printed chit reads like English. */
const humanise = (value?: string | null) =>
  value ? value.replace(/[_-]+/g, " ").toUpperCase() : "";

const formatStamp = (value?: string | Date | null) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  });
};

/** Short, human-quotable order code — the last 6 characters of the id. */
export const receiptCode = (id: string) => id.slice(-6).toUpperCase();

type ReceiptProps = {
  data: ReceiptData;
  className?: string;
};

export const Receipt = forwardRef<HTMLDivElement, ReceiptProps>(
  ({ data, className }, ref) => {
    const linesTotal = data.lines.reduce(
      (sum, line) => sum + line.unitPrice * line.quantity,
      0,
    );
    const total = data.total ?? linesTotal;

    return (
      // Off-screen rather than `display: none` — react-to-print clones the
      // node into an iframe, and a hidden node can measure as zero-height.
      <div
        style={{ position: "absolute", left: "-9999px", top: 0 }}
        aria-hidden="true"
      >
        <div
          ref={ref}
          className={cn(
            "w-[80mm] bg-white p-6 font-mono text-[12px] leading-tight text-black",
            className,
          )}
        >
          <div className="mb-4 border-b-2 border-black pb-4 text-center">
            <h1 className="text-xl font-bold uppercase">Dine Flow</h1>
            <p>Order Receipt</p>
          </div>

          <div className="mb-4 space-y-1 text-[10px]">
            <div className="flex justify-between">
              <span className="font-semibold">Order #:</span>
              <span>{receiptCode(data.orderId)}</span>
            </div>
            <div className="flex justify-between">
              <span>Date:</span>
              <span>{formatStamp(data.createdAt)}</span>
            </div>
            {data.orderType && (
              <div className="flex justify-between">
                <span>Type:</span>
                <span className="uppercase">{humanise(data.orderType)}</span>
              </div>
            )}
            {data.tableName && (
              <div className="flex justify-between">
                <span>Table:</span>
                <span className="font-bold uppercase">{data.tableName}</span>
              </div>
            )}
            {data.paymentMethod && (
              <div className="flex justify-between">
                <span>Paid by:</span>
                <span className="uppercase">{humanise(data.paymentMethod)}</span>
              </div>
            )}
          </div>

          <div className="mb-2 border-b border-dashed border-black" />

          <table className="mb-4 w-full text-[10px]">
            <thead>
              <tr className="border-b border-gray-400">
                <th className="w-8 py-1 text-left">Qty</th>
                <th className="py-1 text-left">Item</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line, index) => (
                <tr key={`${line.name}-${index}`} className="align-top">
                  <td className="py-1.5 font-semibold">{line.quantity}x</td>
                  <td className="py-1.5 pr-2">
                    {line.name}
                    {/* Kitchen notes travel with the chit so a reprint still
                        tells the pass what was asked for. */}
                    {line.notes ? (
                      <span className="block font-semibold italic">
                        &gt; {line.notes}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right">
                    {formatMoney(line.unitPrice * line.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex justify-between border-t-2 border-black pt-2 text-sm font-bold">
            <span>TOTAL</span>
            <span>{formatMoney(total)}</span>
          </div>

          <div className="mt-8 space-y-2 text-center">
            <p className="text-[10px] font-semibold">
              Thank you for dining with us!
            </p>
            {/* Fake barcode representation */}
            <p className="font-mono text-lg tracking-[0.3em]">
              *{receiptCode(data.orderId)}*
            </p>
          </div>
        </div>
      </div>
    );
  },
);

Receipt.displayName = "Receipt";

/**
 * Wire up printing for any printable block — a receipt or the day-close report.
 *
 * The caller owns the data: set state, then call `print()` on the next tick so
 * React has committed the new content before the iframe is cloned. Without that
 * gap the printout shows whatever was there before.
 *
 * `documentTitle` is a getter rather than a string so the caller can name the
 * file after what is currently on screen; it is read during render, so it
 * always reflects the latest state.
 */
export function usePrint(options?: {
  documentTitle?: () => string;
  onAfterPrint?: () => void;
}) {
  const receiptRef = useRef<HTMLDivElement>(null);

  const print = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: options?.documentTitle?.() ?? "DineFlow",
    onAfterPrint: options?.onAfterPrint,
  });

  return { receiptRef, print };
}

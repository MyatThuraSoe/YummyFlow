import { Clock, UtensilsCrossed, ShoppingBag, Truck, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  elapsedMinutes,
  formatElapsed,
  ticketCode,
  urgencyOf,
} from "@/lib/time";
import type { OrderTicket, OpenOrderStatus } from "@/lib/api";

/** What the single action button does in each column. */
const ADVANCE_LABEL: Record<OpenOrderStatus, string> = {
  PENDING: "Start cooking",
  PREPARING: "Mark ready",
  READY: "Mark served",
};

const ORDER_TYPE_ICON = {
  DINE_IN: UtensilsCrossed,
  TAKEAWAY: ShoppingBag,
  DELIVERY: Truck,
} as const;

/** A destination a runner can actually walk to. */
function destinationLabel(ticket: OrderTicket) {
  if (ticket.table?.name) return `Table ${ticket.table.name}`;
  return ticket.orderType === "DELIVERY" ? "Delivery" : "Takeaway";
}

export default function TicketCard({
  ticket,
  now,
  onAdvance,
  isPending,
}: {
  ticket: OrderTicket;
  now: number;
  onAdvance: (ticket: OrderTicket) => void;
  isPending: boolean;
}) {
  const minutes = elapsedMinutes(ticket.createdAt, now);
  const urgency = urgencyOf(minutes);
  const isLate = urgency === "late";
  const isWarn = urgency === "warn";

  const TypeIcon = ORDER_TYPE_ICON[ticket.orderType] ?? ShoppingBag;
  const totalItems = ticket.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <article
      className={cn(
        "rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col transition-colors",
        isLate
          ? "border-red-300 dark:border-red-900"
          : isWarn
            ? "border-amber-300 dark:border-amber-900"
            : "border-border",
      )}
    >
      {/* ── header ─────────────────────────────────────────────── */}
      <header
        className={cn(
          "flex items-start justify-between gap-3 px-4 py-3 border-b",
          isLate
            ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900"
            : isWarn
              ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
              : "bg-muted/40 border-border",
        )}
      >
        <div className="min-w-0">
          <p className="font-mono text-lg font-black tracking-tight text-foreground leading-none">
            #{ticketCode(ticket.id)}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground truncate">
            <TypeIcon className="w-4 h-4 shrink-0" />
            {destinationLabel(ticket)}
          </p>
        </div>

        <div
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums shrink-0",
            isLate
              ? "bg-red-600 text-white"
              : isWarn
                ? "bg-amber-500 text-white"
                : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
          )}
        >
          <Clock className="w-3.5 h-3.5" />
          {formatElapsed(minutes)}
        </div>
      </header>

      {/* ── items ──────────────────────────────────────────────── */}
      <ul className="flex-1 divide-y divide-border/60">
        {ticket.items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 min-w-9 shrink-0 rounded-md bg-primary/10 px-2 py-1 text-center text-base font-black text-primary tabular-nums">
              {item.quantity}
            </span>
            <div className="min-w-0">
              <p className="text-base font-semibold leading-snug text-foreground">
                {item.menuItem.name}
              </p>
              {item.notes && (
                <p className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {item.notes}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* ── action ─────────────────────────────────────────────── */}
      <footer className="border-t border-border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {totalItems} {totalItems === 1 ? "item" : "items"}
        </p>
        <button
          type="button"
          onClick={() => onAdvance(ticket)}
          disabled={isPending}
          className={cn(
            "w-full rounded-lg px-4 py-3 text-base font-bold transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
            isPending
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.99]",
          )}
        >
          {isPending ? "Updating…" : ADVANCE_LABEL[ticket.status]}
        </button>
      </footer>
    </article>
  );
}

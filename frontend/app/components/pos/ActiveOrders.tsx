import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Banknote, Printer, RefreshCw, UtensilsCrossed, ShoppingBag, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import { qk } from "@/lib/query-keys";
import {
  getPosActiveOrders,
  updateOrderPayment,
  updateOrderStatus,
  NEXT_OPEN_STATUS,
  type PosActiveOrder,
  type OpenOrderStatus,
} from "@/lib/api";
import { elapsedMinutes, formatElapsed, ticketCode, urgencyOf } from "@/lib/time";
import { Receipt } from "@/components/receipt/Receipt";
import { useReprint } from "@/components/receipt/useReprint";
import type { OrderStatus } from "@/type";

const TICK_MS = 10_000;

const STATUS_CHIP: Record<OpenOrderStatus, string> = {
  PENDING: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
  PREPARING: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  READY: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

const NEXT_LABEL: Record<OpenOrderStatus, string> = {
  PENDING: "Start",
  PREPARING: "Ready",
  READY: "Served",
};

const TYPE_ICON = {
  DINE_IN: UtensilsCrossed,
  TAKEAWAY: ShoppingBag,
  DELIVERY: Truck,
} as const;

type Filter = "ALL" | OpenOrderStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "New" },
  { key: "PREPARING", label: "Preparing" },
  { key: "READY", label: "Ready" },
];

type BoardResponse = { data: PosActiveOrder[]; serverTime: string };

/**
 * The till's live board.
 *
 * A cashier needs to see what is outstanding, what it is worth and whether it
 * has been paid — without paging through order history. Advancing a ticket and
 * taking payment are both one tap, with optimistic updates so the list keeps up
 * with a rush.
 */
export default function ActiveOrders() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [now, setNow] = useState(() => Date.now());
  const { reprint, busyId: reprintingId, receiptRef, receiptData } = useReprint();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: qk.orders.activePos,
    queryFn: getPosActiveOrders,
    refetchInterval: 60_000,
  });

  /** Applies a change to the cached board so the UI moves before the server replies. */
  const patchBoard = (id: string, patch: Partial<PosActiveOrder>) => {
    queryClient.setQueryData<BoardResponse>(qk.orders.activePos, (old) =>
      old
        ? {
            ...old,
            data: old.data.map((o) => (o.id === id ? { ...o, ...patch } : o)),
          }
        : old,
    );
  };

  const removeFromBoard = (id: string) => {
    queryClient.setQueryData<BoardResponse>(qk.orders.activePos, (old) =>
      old ? { ...old, data: old.data.filter((o) => o.id !== id) } : old,
    );
  };

  const advance = useMutation({
    mutationFn: (vars: { id: string; status: OrderStatus }) =>
      updateOrderStatus(vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: qk.orders.activePos });
      const previous = queryClient.getQueryData<BoardResponse>(qk.orders.activePos);
      if (vars.status === "SERVED" || vars.status === "CANCELLED") {
        removeFromBoard(vars.id);
      } else {
        patchBoard(vars.id, { status: vars.status as OpenOrderStatus });
      }
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(qk.orders.activePos, ctx.previous);
      toast.error(error.message || "Could not update the order");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orders.active });
    },
  });

  const takePayment = useMutation({
    mutationFn: (vars: { id: string; paymentStatus: "PAID" }) =>
      updateOrderPayment(vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: qk.orders.activePos });
      const previous = queryClient.getQueryData<BoardResponse>(qk.orders.activePos);
      patchBoard(vars.id, { paymentStatus: vars.paymentStatus });
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(qk.orders.activePos, ctx.previous);
      toast.error(error.message || "Could not record the payment");
    },
    onSuccess: () => toast.success("Payment recorded"),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orders.active });
    },
  });

  const orders = data?.data ?? [];

  const counts = useMemo(() => {
    const base: Record<Filter, number> = {
      ALL: orders.length,
      PENDING: 0,
      PREPARING: 0,
      READY: 0,
    };
    for (const o of orders) base[o.status] += 1;
    return base;
  }, [orders]);

  const visible = useMemo(
    () => (filter === "ALL" ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter],
  );

  const outstanding = useMemo(
    () =>
      orders
        .filter((o) => o.paymentStatus !== "PAID")
        .reduce((sum, o) => sum + o.totalAmount, 0),
    [orders],
  );

  const busyId = advance.isPending
    ? advance.variables?.id
    : takePayment.isPending
      ? takePayment.variables?.id
      : undefined;

  return (
    <div className="p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">
            Active Orders
          </h1>
          <p className="text-sm font-medium text-muted-foreground mt-0.5">
            {counts.ALL} open
            {outstanding > 0 && (
              <>
                {" · "}
                <span className="font-bold text-amber-600 dark:text-amber-400">
                  {formatMoney(outstanding)} unpaid
                </span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          Refresh
        </button>
      </header>

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors",
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            <span className="ml-1.5 tabular-nums opacity-80">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          Could not load the order board. Check the connection and refresh.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 rounded-xl border border-border bg-card/60 animate-pulse"
            />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Nothing outstanding. The pass is clear.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((order) => {
            const minutes = elapsedMinutes(order.createdAt, now);
            const urgency = urgencyOf(minutes, 8, 15);
            const TypeIcon = TYPE_ICON[order.orderType] ?? ShoppingBag;
            const isPaid = order.paymentStatus === "PAID";
            const next = NEXT_OPEN_STATUS[order.status];
            const isBusy = busyId === order.id;

            return (
              <li
                key={order.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border bg-card px-4 py-3",
                  urgency === "late"
                    ? "border-red-300 dark:border-red-900"
                    : "border-border",
                )}
              >
                <div className="min-w-40">
                  <p className="font-mono text-base font-black text-foreground leading-none">
                    #{ticketCode(order.id)}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <TypeIcon className="w-3.5 h-3.5" />
                    {order.table?.name
                      ? `Table ${order.table.name}`
                      : order.orderType.replace("_", " ").toLowerCase()}
                  </p>
                </div>

                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-bold tabular-nums",
                    urgency === "late"
                      ? "bg-red-600 text-white"
                      : urgency === "warn"
                        ? "bg-amber-500 text-white"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {formatElapsed(minutes)}
                </span>

                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-bold",
                    STATUS_CHIP[order.status],
                  )}
                >
                  {order.status.toLowerCase()}
                </span>

                <span className="text-sm font-semibold text-muted-foreground truncate max-w-56">
                  {order.items
                    .map((i) => `${i.quantity}× ${i.menuItem.name}`)
                    .join(", ")}
                </span>

                <div className="ml-auto flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-base font-black tabular-nums text-foreground">
                      {formatMoney(order.totalAmount)}
                    </p>
                    <p
                      className={cn(
                        "text-[11px] font-bold uppercase tracking-wide",
                        isPaid
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {isPaid ? `Paid · ${order.paymentMethod}` : "Unpaid"}
                    </p>
                  </div>

                  {/* Fetches this one order on demand — the board payload has
                      no line prices, so it cannot build a chit by itself. */}
                  <button
                    type="button"
                    disabled={reprintingId === order.id}
                    onClick={() => void reprint(order.id)}
                    title="Reprint receipt"
                    aria-label={`Reprint receipt for order ${ticketCode(order.id)}`}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <Printer
                      className={cn(
                        "w-3.5 h-3.5",
                        reprintingId === order.id && "animate-pulse",
                      )}
                    />
                  </button>

                  {!isPaid && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        takePayment.mutate({ id: order.id, paymentStatus: "PAID" })
                      }
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <Banknote className="w-3.5 h-3.5" />
                      Take payment
                    </button>
                  )}

                  {next && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => advance.mutate({ id: order.id, status: next })}
                      className="rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isBusy ? "…" : NEXT_LABEL[order.status]}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Hidden printable chit, shared by every reprint button on the board. */}
      {receiptData && <Receipt ref={receiptRef} data={receiptData} />}
    </div>
  );
}

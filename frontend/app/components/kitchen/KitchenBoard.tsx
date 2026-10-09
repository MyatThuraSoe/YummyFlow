import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ChefHat, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { qk } from "@/lib/query-keys";
import {
  getActiveOrders,
  updateOrderStatus,
  NEXT_OPEN_STATUS,
  type OpenOrderStatus,
  type OrderTicket,
} from "@/lib/api";
import TicketCard from "./TicketCard";
import type { OrderStatus } from "@/type";

type BoardResponse = { data: OrderTicket[]; serverTime: string };

/**
 * Elapsed badges only show whole minutes, so ticking every second would re-render
 * every ticket sixty times a minute for no visible change.
 */
const TICK_MS = 10_000;

const COLUMNS: {
  status: OpenOrderStatus;
  title: string;
  hint: string;
  accent: string;
}[] = [
  {
    status: "PENDING",
    title: "New",
    hint: "Not started",
    accent: "border-t-slate-400",
  },
  {
    status: "PREPARING",
    title: "On the line",
    hint: "Being cooked",
    accent: "border-t-amber-500",
  },
  {
    status: "READY",
    title: "At the pass",
    hint: "Ready to run",
    accent: "border-t-emerald-500",
  },
];

export default function KitchenBoard() {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  // One shared clock for every elapsed badge on the board.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: qk.orders.active,
    queryFn: getActiveOrders,
    // Socket events push updates; this is a backstop for a dropped connection.
    refetchInterval: 60_000,
  });

  const advance = useMutation({
    mutationFn: (vars: { id: string; status: OrderStatus }) =>
      updateOrderStatus(vars),

    // Move the ticket immediately. A kitchen tapping "Mark ready" should not
    // watch the card sit there for a round-trip.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: qk.orders.active });
      const previous = queryClient.getQueryData<BoardResponse>(qk.orders.active);

      queryClient.setQueryData<BoardResponse>(qk.orders.active, (old) => {
        if (!old) return old;
        return {
          ...old,
          data:
            vars.status === "SERVED" || vars.status === "CANCELLED"
              ? // Finished tickets leave the board entirely.
                old.data.filter((t) => t.id !== vars.id)
              : old.data.map((t) =>
                  t.id === vars.id
                    ? { ...t, status: vars.status as OpenOrderStatus }
                    : t,
                ),
        };
      });

      return { previous };
    },

    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(qk.orders.active, ctx.previous);
      }
      toast.error(error.message || "Could not update the ticket");
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orders.active });
    },
  });

  const tickets = data?.data ?? [];

  const grouped = useMemo(() => {
    const map: Record<OpenOrderStatus, OrderTicket[]> = {
      PENDING: [],
      PREPARING: [],
      READY: [],
    };
    for (const ticket of tickets) map[ticket.status]?.push(ticket);
    return map;
  }, [tickets]);

  const handleAdvance = (ticket: OrderTicket) => {
    if (advance.isPending) return;
    const next = NEXT_OPEN_STATUS[ticket.status];
    if (!next) return;
    advance.mutate({ id: ticket.id, status: next });
  };

  const pendingId = advance.isPending ? advance.variables?.id : undefined;

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border bg-card/80 backdrop-blur px-4 py-3 flex items-center justify-between gap-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <ChefHat className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-foreground leading-tight">
              Kitchen Display
            </h1>
            <p className="text-xs text-muted-foreground">
              {tickets.length} open {tickets.length === 1 ? "ticket" : "tickets"}
            </p>
          </div>
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

      {isError && (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          Could not reach the kitchen board. Check the connection and refresh.
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {COLUMNS.map((column) => {
            const items = grouped[column.status];
            return (
              <section
                key={column.status}
                className={cn(
                  "rounded-xl border border-t-4 border-border bg-muted/30 p-3",
                  column.accent,
                )}
              >
                <div className="flex items-baseline justify-between px-1 pb-3">
                  <div>
                    <h2 className="text-base font-bold text-foreground">
                      {column.title}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {column.hint}
                    </p>
                  </div>
                  <span className="rounded-full bg-card border border-border px-2.5 py-0.5 text-sm font-bold tabular-nums text-foreground">
                    {items.length}
                  </span>
                </div>

                {isLoading ? (
                  <div className="space-y-3">
                    {[0, 1].map((i) => (
                      <div
                        key={i}
                        className="h-40 rounded-xl border border-border bg-card/60 animate-pulse"
                      />
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                    Nothing here
                  </p>
                ) : (
                  <div className="space-y-3">
                    {items.map((ticket) => (
                      <TicketCard
                        key={ticket.id}
                        ticket={ticket}
                        now={now}
                        onAdvance={handleAdvance}
                        isPending={pendingId === ticket.id}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

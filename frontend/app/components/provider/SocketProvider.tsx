import { useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { BellRing, ChefHat, CalendarClock, BrainCircuit } from "lucide-react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { OrderStatus, ReservationStatus } from "@/type";
import { socket } from "@/lib/socket";
import { qk } from "@/lib/query-keys";

/**
 * Fast lane: collapse an event burst into one flush. A single order emits
 * `new-order` plus a status change per kitchen transition; un-batched, a
 * five-station restaurant (till, kitchen, two waiters, host desk) turned one
 * order into a storm of full paginated refetches.
 */
const LIVE_WINDOW_MS = 400;

/**
 * Slow lane: analytics rollups (dashboard totals, charts, AI briefings) are
 * expensive to compute and nobody reads them second-by-second. Refresh at most
 * once a minute regardless of how many orders land.
 */
const AGGREGATE_WINDOW_MS = 60_000;

/**
 * Returns a function that queues query-key prefixes and flushes them once per
 * window, de-duplicated.
 *
 * The timer is armed by the first call and deliberately not reset by later
 * ones, so a steady stream of events still yields at most one flush per window
 * (a trailing throttle, not a debounce that can be starved).
 *
 * De-duplication relies on reference equality, so callers must pass the stable
 * constants from `@/lib/query-keys` rather than building arrays inline.
 */
function useCoalescedInvalidator(queryClient: QueryClient, windowMs: number) {
  const pending = useRef(new Set<readonly unknown[]>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Never leave a timer running after unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      pending.current.clear();
    };
  }, []);

  // Stable identity: this ends up in the socket effect's dependency array, so a
  // new function each render would tear down and re-attach every listener.
  return useCallback(
    (keys: readonly (readonly unknown[])[]) => {
      for (const key of keys) pending.current.add(key);

      if (timer.current) return; // a flush is already scheduled

      timer.current = setTimeout(() => {
        timer.current = null;
        const batch = Array.from(pending.current);
        pending.current.clear();

        for (const queryKey of batch) {
          // Only queries that are currently mounted will actually refetch;
          // the rest are simply marked stale for their next mount.
          void queryClient.invalidateQueries({ queryKey: [...queryKey] });
        }
      }, windowMs);
    },
    [queryClient, windowMs],
  );
}

/** Staff-facing alert tone. Autoplay can be blocked before first interaction. */
function playAlert() {
  void new Audio("/sounds/notification.mp3").play().catch(() => {});
}

export default function SocketProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const invalidate = useCoalescedInvalidator(queryClient, LIVE_WINDOW_MS);
  const invalidateAggregates = useCoalescedInvalidator(
    queryClient,
    AGGREGATE_WINDOW_MS,
  );

  /**
   * Order and reservation traffic changes the dashboard rollups, but those are
   * expensive to recompute. Route them through the slow lane so a dinner rush
   * cannot trigger a rollup per cover.
   */
  const touchDashboard = useCallback(() => {
    invalidateAggregates([qk.dashboard.all]);
  }, [invalidateAggregates]);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    // ========================================================
    // 1. NEW ORDERS (Loud alert — for kitchen and cashier)
    // ========================================================
    socket.on("new-order", (data) => {
      playAlert();
      toast.custom(
        (t) => (
          <div className="bg-white dark:bg-card border border-border shadow-lg rounded-2xl p-4 flex items-start gap-4 animate-in slide-in-from-top-2">
            <div className="bg-orange-100 text-orange-600 p-2 rounded-full shrink-0">
              <BellRing className="w-6 h-6 animate-bounce" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-foreground">
                New Order #{data.orderNumber}
              </h3>
              <p className="text-sm text-muted-foreground">{data.message}</p>
            </div>
          </div>
        ),
        { duration: 5000, position: "top-center" },
      );

      invalidate([qk.orders.all, qk.orders.active, ...tableInvalidationKeys()]);
      touchDashboard();
    });

    // ========================================================
    // 2. ORDER STATUS CHANGED
    // ========================================================
    socket.on("order-status-changed", (data) => {
      invalidate([qk.orders.all, qk.orders.active, ...tableInvalidationKeys()]);
      touchDashboard();

      const status: OrderStatus = data.status;

      // Only READY is actionable for a waiter — it is the cue to walk the food
      // out. Ringing on every transition (PENDING → PREPARING → SERVED) turned
      // a busy service into constant noise.
      if (status !== "READY") return;

      playAlert();
      toast.custom(
        (t) => (
          <div className="bg-white dark:bg-card border border-border shadow-lg rounded-2xl p-4 flex items-start gap-4">
            <div className="bg-blue-100 text-primary p-2 rounded-full shrink-0">
              <ChefHat className="w-6 h-6 animate-pulse" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-foreground">
                Order #{data.orderId} is ready to serve
              </h3>
              <p className="text-sm text-muted-foreground">
                Pick it up from the pass.
              </p>
            </div>
          </div>
        ),
        { duration: 8000, position: "top-center" },
      );
    });

    // ========================================================
    // 3. NEW RESERVATION (Loud alert — host desk)
    // ========================================================
    socket.on("new-reservation", (data) => {
      invalidate([qk.reservations.all]);
      touchDashboard();

      playAlert();
      toast.custom(
        (t) => (
          <div className="bg-white dark:bg-card border border-border shadow-lg rounded-2xl p-4 flex items-start gap-4">
            <div className="bg-emerald-100 text-emerald-600 p-2 rounded-full shrink-0">
              <CalendarClock className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-foreground">New Table Booking</h3>
              <p className="text-sm text-muted-foreground">
                {data.name} just booked a table online.
              </p>
            </div>
          </div>
        ),
        { duration: 6000, position: "top-center" },
      );
    });

    // ========================================================
    // 4. RESERVATION STATUS CHANGED (host desk)
    // ========================================================
    socket.on("status-reservation", (data) => {
      invalidate([qk.reservations.all, ...tableInvalidationKeys()]);
      touchDashboard();

      const status: ReservationStatus = data.status;
      playAlert();
      toast.custom(
        (t) => (
          <div className="bg-white dark:bg-card border border-border shadow-lg rounded-2xl p-4 flex items-start gap-4">
            <div className="bg-emerald-100 text-emerald-600 p-2 rounded-full shrink-0">
              <CalendarClock className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-foreground">
                Reservation{" "}
                {status === "PENDING"
                  ? "Pending"
                  : status === "CONFIRMED"
                    ? "Confirmed"
                    : status === "CANCELLED"
                      ? "Cancelled"
                      : status === "COMPLETED"
                        ? "Completed"
                        : "Updated"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {data.name}'s reservation is now {status.toLowerCase()}.
              </p>
            </div>
          </div>
        ),
        { duration: 6000, position: "top-center" },
      );
    });

    // ========================================================
    // 5. SILENT DATA SYNCS (no sound, just fresh data)
    // ========================================================

    // A table was created, occupied, freed, or deleted.
    socket.on("table-updated", () => {
      invalidate(tableInvalidationKeys());
    });

    // Menu items changed.
    socket.on("menu-updated", () => {
      // Reviews ride on the menu event: a new rating changes both the dish's
      // precomputed average (on the menu payload) and the open review list,
      // and those two live under different key prefixes.
      invalidate([qk.menu.all, qk.menu.reviewsRoot]);
    });

    // A party joined, moved, or left the queue.
    socket.on("waitlist-updated", () => {
      invalidate([qk.waitlist.all]);
    });

    // Stock moved: an order consumed it, a cancellation returned it, or a
    // manager restocked. Silent — a busy service would otherwise toast per dish.
    socket.on("inventory-updated", () => {
      invalidate([qk.inventory.all]);
    });

    // AI menu action status.
    socket.on("ai-action-updated", (data) => {
      const action = data.action;
      toast.custom(
        (t) => (
          <div className="bg-white dark:bg-card border border-border shadow-lg rounded-2xl p-4 flex items-start gap-4">
            <div className="bg-emerald-100 text-emerald-600 p-2 rounded-full shrink-0">
              <BrainCircuit className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-foreground">{action}</h3>
            </div>
          </div>
        ),
        { duration: 6000, position: "top-center" },
      );
    });

    // ========================================================
    // 6. AI BRIEFING READY (pro — scheduled or on-demand)
    // ========================================================
    socket.on("briefing-ready", (data: { kind: string; headline: string }) => {
      invalidate([qk.briefings.all, qk.briefings.metrics]);

      toast.custom(
        (t) => (
          <div className="bg-white dark:bg-card border border-border shadow-lg rounded-2xl p-4 flex items-start gap-4">
            <div className="bg-violet-100 text-violet-600 p-2 rounded-full shrink-0">
              <BrainCircuit className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-foreground">
                {data.kind === "FORECAST"
                  ? "Weekly demand forecast ready"
                  : "Executive briefing ready"}
              </h3>
              <p className="text-sm text-muted-foreground">{data.headline}</p>
            </div>
          </div>
        ),
        { duration: 8000, position: "top-center" },
      );
    });

    return () => {
      socket.off("new-order");
      socket.off("order-status-changed");
      socket.off("new-reservation");
      socket.off("status-reservation");
      socket.off("table-updated");
      socket.off("menu-updated");
      socket.off("waitlist-updated");
      socket.off("inventory-updated");
      socket.off("ai-action-updated");
      socket.off("briefing-ready");
    };
  }, [invalidate, touchDashboard]);

  return <>{children}</>;
}

/**
 * The floor plan and the public booking page read the same tables through two
 * different endpoints whose keys share no prefix. Invalidating one leaves the
 * other stale, so table-touching events always refresh both.
 */
function tableInvalidationKeys(): readonly (readonly unknown[])[] {
  return [qk.tables.all, qk.tables.public];
}

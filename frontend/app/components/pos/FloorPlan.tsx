import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import toast from "react-hot-toast";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useLocation } from "react-router";
import { cn } from "@/lib/utils";
import type { TableStatus, TablesProps } from "@/type";
import Loader from "@/components/global/Loader";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Trash, Users, Sparkles, CheckCheck, Receipt } from "lucide-react";
import CreateEdit from "@/components/tables/CreateEdit";
import { posCart } from "@/store";
import { useSnapshot } from "valtio";
import { customFetch, deleteTable, updateTableStatus } from "@/lib/api";
import { qk, tableDependentKeys } from "@/lib/query-keys";
import { elapsedMinutes, formatElapsed, ticketCode, urgencyOf } from "@/lib/time";
import { formatMoney } from "@/lib/currency";

const SECTIONS = ["Main Dining Room", "Outdoor", "Terrace"] as const;

/**
 * Elapsed badges show whole minutes, so a one-second tick would re-render every
 * table sixty times a minute for no visible change.
 */
const TICK_MS = 10_000;

const STATUS_STYLE: Record<
  TableStatus,
  { label: string; dot: string; ring: string; chip: string }
> = {
  AVAILABLE: {
    label: "Available",
    dot: "bg-emerald-500",
    ring: "border-emerald-300 dark:border-emerald-900",
    chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  OCCUPIED: {
    label: "Seated",
    dot: "bg-orange-500",
    ring: "border-orange-300 dark:border-orange-900",
    chip: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  },
  RESERVED: {
    label: "Reserved",
    dot: "bg-blue-500",
    ring: "border-blue-300 dark:border-blue-900",
    chip: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  },
  CLEANING: {
    label: "Needs bussing",
    dot: "bg-slate-400",
    ring: "border-slate-300 dark:border-slate-700",
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
  },
};

/**
 * The single action a table offers in its current state.
 *
 * These used to be an implicit click-toggle between AVAILABLE and OCCUPIED,
 * which made it impossible to tell whether a tap had seated a party or cleared
 * a table. Naming the action removes the guesswork.
 */
const NEXT_ACTION: Partial<
  Record<TableStatus, { label: string; next: TableStatus; icon: typeof Users }>
> = {
  AVAILABLE: { label: "Seat guests", next: "OCCUPIED", icon: Users },
  RESERVED: { label: "Seat guests", next: "OCCUPIED", icon: Users },
  OCCUPIED: { label: "Clear table", next: "CLEANING", icon: Sparkles },
  CLEANING: { label: "Ready to use", next: "AVAILABLE", icon: CheckCheck },
};

const FloorPlan = ({
  showHeader = true,
  className,
}: {
  showHeader?: boolean;
  className?: string;
}) => {
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[1]);
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const tableState = useSnapshot(posCart.state).table;
  const { data: session } = authClient.useSession();

  // This used to read `role === "ADMIN" || "MANAGER"`, which evaluates to
  // ("ADMIN" === role) || "MANAGER" — always truthy — so STAFF and KITCHEN were
  // shown the destructive table controls.
  const role = session?.user?.role;
  const canEdit = role === "ADMIN" || role === "MANAGER";

  /** Selecting a table for an in-progress order, rather than managing the floor. */
  const isPickingTable = pathname === "/pos/new-order";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const {
    data: tables = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: qk.tables.all,
    queryFn: () => customFetch<TablesProps[]>("/tables"),
  });

  const displayTables = useMemo(
    () => tables.filter((t) => t.section === activeSection),
    [tables, activeSection],
  );

  const counts = useMemo(() => {
    const base: Record<TableStatus, number> = {
      AVAILABLE: 0,
      OCCUPIED: 0,
      RESERVED: 0,
      CLEANING: 0,
    };
    for (const t of displayTables) base[t.status] += 1;
    return base;
  }, [displayTables]);

  const statusMutation = useMutation({
    mutationFn: updateTableStatus,
    // Move the table immediately; a host seating a party should not wait on a
    // round-trip to see the floor update.
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: qk.tables.all });
      const previous = queryClient.getQueryData<TablesProps[]>(qk.tables.all);
      queryClient.setQueryData<TablesProps[]>(qk.tables.all, (old) =>
        old?.map((t) => (t.id === vars.id ? { ...t, status: vars.status } : t)),
      );
      return { previous };
    },
    onError: (error: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(qk.tables.all, ctx.previous);
      toast.error(error.message || "Could not update the table");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tableDependentKeys });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTable,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tableDependentKeys });
      toast.success("Table deleted");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Failed to delete table");
    },
  });

  const isBusy = statusMutation.isPending || deleteMutation.isPending;

  const handleTableClick = (table: TablesProps) => {
    if (isPickingTable) {
      if (table.id === tableState?.id) {
        toast.error("This table is already selected for the current order.");
        return;
      }
      if (table.status !== "AVAILABLE") {
        toast.error(`Table ${table.name} is ${STATUS_STYLE[table.status].label.toLowerCase()}.`);
        return;
      }
      posCart.actions.setTable(table);
      toast.success(`Table ${table.name} selected.`);
      return;
    }

    // Floor-management mode: the card's action button does the work, so a
    // stray tap on the card body must not change anything.
  };

  const handleAction = (table: TablesProps) => {
    const action = NEXT_ACTION[table.status];
    if (!action || isBusy) return;
    statusMutation.mutate({ id: table.id, status: action.next });
  };

  const handleDeleteTable = (table: TablesProps) => {
    if (isBusy) return;
    if (table.status !== "AVAILABLE") {
      toast.error("Only an available table can be deleted.");
      return;
    }
    deleteMutation.mutate({ id: table.id });
  };

  return (
    <div className={cn("", className)}>
      {showHeader && (
        <header className="border-b sticky w-full top-0 z-10 bg-card/80 backdrop-blur">
          <div className="px-4 py-2 flex items-center justify-between">
            <div className="flex gap-2 items-center">
              <SidebarTrigger className="-ml-1" />
              <h1 className="text-2xl font-bold text-foreground">Floor Plan</h1>
            </div>
            {canEdit && <CreateEdit isLoading={isBusy} />}
          </div>
        </header>
      )}

      <div className="flex flex-col h-[89vh] overflow-hidden p-4">
        <div className="flex-1 border border-border rounded-2xl shadow-sm p-6 flex flex-col bg-card/40">
          <Tabs
            value={activeSection}
            onValueChange={setActiveSection}
            className="w-full mb-4"
          >
            <TabsList className="bg-transparent h-auto p-0 gap-8 justify-start border-b border-border w-full rounded-none">
              {SECTIONS.map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="data-[state=active]:bg-primary dark:data-[state=active]:bg-primary mb-4 py-4"
                >
                  {tab}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Live counts — the host desk needs the shape of the floor at a glance */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 text-sm font-semibold">
            {(
              ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING"] as TableStatus[]
            ).map((status) => (
              <span key={status} className="flex items-center gap-2">
                <span
                  className={cn("w-3 h-3 rounded-full", STATUS_STYLE[status].dot)}
                />
                <span className="text-muted-foreground">
                  {STATUS_STYLE[status].label}
                </span>
                <span className="tabular-nums text-foreground">
                  {counts[status]}
                </span>
              </span>
            ))}
          </div>

          {isLoading ? (
            <Loader title="Loading tables..." className="flex-1" />
          ) : (
            <div className="flex-1 overflow-auto">
              {displayTables.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No tables in {activeSection}.
                </p>
              ) : (
                <div className="flex flex-wrap gap-4 justify-center content-start">
                  {displayTables.map((table) => (
                    <TableCard
                      key={table.id}
                      table={table}
                      now={now}
                      isPickingTable={isPickingTable}
                      isSelected={table.id === tableState?.id}
                      isBusy={isBusy}
                      pendingId={statusMutation.isPending ? statusMutation.variables?.id : undefined}
                      canEdit={canEdit}
                      onSelect={handleTableClick}
                      onAction={handleAction}
                      onDelete={handleDeleteTable}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function TableCard({
  table,
  now,
  isPickingTable,
  isSelected,
  isBusy,
  pendingId,
  canEdit,
  onSelect,
  onAction,
  onDelete,
}: {
  table: TablesProps;
  now: number;
  isPickingTable: boolean;
  isSelected: boolean;
  isBusy: boolean;
  pendingId?: string;
  canEdit: boolean;
  onSelect: (t: TablesProps) => void;
  onAction: (t: TablesProps) => void;
  onDelete: (t: TablesProps) => void;
}) {
  const style = STATUS_STYLE[table.status];
  const action = NEXT_ACTION[table.status];
  const isThisPending = pendingId === table.id;

  const openOrder = table.orders?.[0];
  const minutes = openOrder ? elapsedMinutes(openOrder.createdAt, now) : 0;
  const urgency = openOrder ? urgencyOf(minutes) : "normal";

  const nextReservation = table.reservations?.[0];

  const selectable = isPickingTable && table.status === "AVAILABLE";

  return (
    <div
      className={cn(
        "w-56 rounded-xl border-2 bg-card shadow-sm overflow-hidden transition-colors",
        style.ring,
        isSelected && "ring-2 ring-primary ring-offset-2",
        isThisPending && "opacity-60",
      )}
    >
      {/* header */}
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div className="flex items-start gap-2 min-w-0">
          {/* Keeps the original floor-plan shape language: square / circle /
              rectangle tables read differently at a glance. */}
          <span
            aria-hidden
            className={cn(
              "mt-0.5 w-3.5 h-3.5 shrink-0 border-2",
              style.ring,
              table.shape === "circle"
                ? "rounded-full"
                : table.shape === "rectangle"
                  ? "w-5 rounded-[3px]"
                  : "rounded-[3px]",
            )}
          />
          <div className="min-w-0">
            <p className="text-lg font-black leading-none text-foreground truncate">
              {table.name}
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
              <Users className="w-3.5 h-3.5" />
              {table.seats} seats
            </p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
            style.chip,
          )}
        >
          {style.label}
        </span>
      </div>

      {/* live detail */}
      <div className="px-3 py-3 min-h-16">
        {openOrder ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-bold text-foreground">
                #{ticketCode(openOrder.id)}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                  urgency === "late"
                    ? "bg-red-600 text-white"
                    : urgency === "warn"
                      ? "bg-amber-500 text-white"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {formatElapsed(minutes)}
              </span>
            </div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Receipt className="w-3.5 h-3.5" />{formatMoney(openOrder.totalAmount)}
              <span className="text-border">·</span>
              {openOrder.status.replace("_", " ").toLowerCase()}
            </p>
          </div>
        ) : nextReservation ? (
          <p className="text-xs font-semibold text-muted-foreground">
            Booked{" "}
            {new Date(nextReservation.date).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · {nextReservation.guests}p
            {nextReservation.customerName
              ? ` · ${nextReservation.customerName}`
              : ""}
          </p>
        ) : (
          <p className="text-xs font-semibold text-muted-foreground">
            {table.status === "CLEANING" ? "Waiting on bussing" : "Ready to seat"}
          </p>
        )}
      </div>

      {/* actions */}
      <div className="flex items-center gap-2 border-t border-border p-2">
        {isPickingTable ? (
          <Button
            size="sm"
            variant={selectable ? "default" : "secondary"}
            disabled={!selectable || isThisPending}
            onClick={() => onSelect(table)}
            className="flex-1 h-9 text-xs font-bold"
          >
            {isSelected ? "Selected" : selectable ? "Select table" : "Unavailable"}
          </Button>
        ) : (
          action && (
            <Button
              size="sm"
              variant={table.status === "OCCUPIED" ? "secondary" : "default"}
              disabled={isBusy}
              onClick={() => onAction(table)}
              className="flex-1 h-9 text-xs font-bold gap-1.5"
            >
              <action.icon className="w-3.5 h-3.5" />
              {isThisPending ? "Updating…" : action.label}
            </Button>
          )
        )}

        {canEdit && (
          <>
            <CreateEdit
              table={table}
              isLoading={isBusy || table.status === "OCCUPIED"}
            />
            <Button
              size="icon"
              variant="ghost"
              disabled={isBusy || table.status !== "AVAILABLE"}
              onClick={() => onDelete(table)}
              className="h-9 w-9 text-destructive hover:bg-destructive/10 shrink-0"
              aria-label={`Delete table ${table.name}`}
            >
              <Trash className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default FloorPlan;

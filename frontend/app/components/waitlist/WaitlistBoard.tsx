import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  customFetch,
  getWaitlist,
  removeWaitlistEntry,
  updateWaitlistStatus,
  type WaitlistEntry,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { TablesProps } from "@/type";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Armchair,
  Clock,
  Loader2,
  Phone,
  Search,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

/** Past this, a party is not "a short wait" any more. */
const LONG_WAIT_MINUTES = 45;

const formatWait = (minutes: number) => {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const Stat = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) => (
  <Card className="flex-1 min-w-[8rem]">
    <CardHeader className="pb-2">
      <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-black tabular-nums">{value}</div>
      {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    </CardContent>
  </Card>
);

/**
 * Host's view of the door.
 *
 * Queue is ordered by arrival (the server returns `position` that way and does
 * not sort client-side) so the host cannot accidentally reshuffle a queue by
 * filtering. The search box is for finding one party in a long queue, not for
 * deciding who is served next — the served order stays the arrival order.
 */
const WaitlistBoard = () => {
  const queryClient = useQueryClient();
  const [seatingId, setSeatingId] = useState<string | null>(null);
  const [tableFor, setTableFor] = useState<string>("");
  const [search, setSearch] = useState("");

  const { data, isPending } = useQuery({
    queryKey: qk.waitlist.board,
    queryFn: async () => (await getWaitlist()).data,
    refetchInterval: 30_000,
  });

  const { data: tables = [] } = useQuery<TablesProps[]>({
    queryKey: qk.tables.all,
    queryFn: () => customFetch("/tables"),
  });

  // Only free tables big enough for the party. Offering a two-top for four
  // covers is how a host learns the hard way.
  const freeTablesFor = useMemo(
    () => (entry: WaitlistEntry) =>
      tables.filter(
        (t) =>
          t.status === "AVAILABLE" &&
          t.seats >= entry.guests &&
          !t.orders.some((o) => o.status !== "CANCELLED"),
      ),
    [tables],
  );

  const visible = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return data.waiting;
    return data.waiting.filter(
      (e) =>
        e.customerName.toLowerCase().includes(needle) ||
        (e.phone ?? "").includes(needle),
    );
  }, [data, search]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.waitlist.all });

  const statusMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      status: "SEATED" | "NO_SHOW" | "CANCELLED";
      tableId?: string | null;
    }) => updateWaitlistStatus(vars),
    onSuccess: async (_res, vars) => {
      setSeatingId(null);
      setTableFor("");
      // Seating a party changes table state as well, so the floor plan and the
      // public booking list have to follow — the same reasoning as
      // `tableDependentKeys` in query-keys.
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: qk.tables.all }),
        queryClient.invalidateQueries({ queryKey: qk.tables.public }),
      ]);
      toast.success(
        vars.status === "SEATED" ? "Party seated." : "Queue updated.",
      );
    },
    onError: (e: Error) => toast.error(e.message || "Could not update."),
  });

  const removeMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => removeWaitlistEntry({ id }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Entry removed.");
    },
    onError: (e: Error) => toast.error(e.message || "Could not remove."),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Stat
          label="Waiting"
          value={String(data?.stats.waiting ?? 0)}
          hint={`${data?.stats.coversWaiting ?? 0} covers`}
        />
        <Stat label="Seated today" value={String(data?.stats.seatedToday ?? 0)} />
        <Stat
          label="Average wait"
          value={
            data?.stats.averageWaitMinutes != null
              ? formatWait(data.stats.averageWaitMinutes)
              : "—"
          }
          hint="across parties seated today"
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a party by name or phone"
            className="pl-8"
          />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
            Clear
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus size={16} className="text-primary" />
            Queue
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isPending ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-10 px-4">
              <UserPlus
                size={20}
                className="mx-auto text-muted-foreground/40 mb-2"
              />
              <p className="font-medium">
                {search ? "No matching party" : "No one waiting"}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {search
                  ? "Try a different name or phone number."
                  : "Walk-ins will appear here the moment they join the queue."}
              </p>
            </div>
          ) : (
            <ScrollArea className="max-h-[60vh] w-full">
              <div className="divide-y">
                {visible.map((entry) => {
                  const seating = seatingId === entry.id;
                  const options = freeTablesFor(entry);
                  const longWait = entry.waitingMinutes >= LONG_WAIT_MINUTES;

                  return (
                    <div
                      key={entry.id}
                      className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center"
                    >
                      <div className="flex items-center gap-3 sm:w-12 shrink-0">
                        <span
                          className="text-xl font-black tabular-nums text-muted-foreground"
                          aria-label={`Position ${entry.position}`}
                        >
                          {entry.position}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold truncate">
                            {entry.customerName}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">
                            {entry.guests} {entry.guests === 1 ? "guest" : "guests"}
                          </Badge>
                          {longWait && (
                            <Badge
                              variant="destructive"
                              className="text-[10px] gap-1"
                            >
                              <Clock size={9} />
                              Long wait
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Clock size={11} />
                            waiting {formatWait(entry.waitingMinutes)}
                          </span>
                          {entry.phone && (
                            <a
                              href={`tel:${entry.phone}`}
                              className="inline-flex items-center gap-1 hover:text-foreground"
                            >
                              <Phone size={11} />
                              {entry.phone}
                            </a>
                          )}
                          {entry.table && (
                            <span className="inline-flex items-center gap-1">
                              <Armchair size={11} />
                              prefers {entry.table.name}
                            </span>
                          )}
                        </div>
                        {entry.notes && (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            {entry.notes}
                          </p>
                        )}
                      </div>

                      {seating ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <Select value={tableFor} onValueChange={setTableFor}>
                            <SelectTrigger className="w-[9.5rem]">
                              <SelectValue placeholder="Assign table" />
                            </SelectTrigger>
                            <SelectContent>
                              {options.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name} ({t.seats})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            disabled={!tableFor || statusMutation.isPending}
                            onClick={() =>
                              statusMutation.mutate({
                                id: entry.id,
                                status: "SEATED",
                                tableId: tableFor,
                              })
                            }
                          >
                            Seat
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSeatingId(null);
                              setTableFor("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            disabled={options.length === 0}
                            title={
                              options.length === 0
                                ? `No free table seats ${entry.guests}`
                                : undefined
                            }
                            onClick={() => {
                              setSeatingId(entry.id);
                              setTableFor("");
                            }}
                          >
                            Seat
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={statusMutation.isPending}
                            onClick={() =>
                              statusMutation.mutate({
                                id: entry.id,
                                status: "NO_SHOW",
                              })
                            }
                          >
                            No show
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={removeMutation.isPending}
                            onClick={() => removeMutation.mutate({ id: entry.id })}
                          >
                            <UserMinus size={14} />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {data && data.recent.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-muted-foreground">
              Recently resolved
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.recent.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between text-sm py-1"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{entry.customerName}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {entry.guests}p
                  </span>
                  {entry.table && (
                    <>
                      <Separator orientation="vertical" className="h-3" />
                      <span className="text-xs text-muted-foreground shrink-0">
                        {entry.table.name}
                      </span>
                    </>
                  )}
                </div>
                <Badge
                  variant={
                    entry.status === "SEATED"
                      ? "default"
                      : entry.status === "NO_SHOW"
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-[10px] shrink-0"
                >
                  {entry.status.replace("_", " ").toLowerCase()}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default WaitlistBoard;

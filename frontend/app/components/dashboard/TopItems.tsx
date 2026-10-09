import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { getSalesAnalytics, type TopItem } from "@/lib/api";
import { qk, SAFETY_POLL_MS } from "@/lib/query-keys";
import { formatMoney } from "@/lib/currency";

/**
 * Best sellers by revenue.
 *
 * Ranked by money, not by count, and it says so — a high-volume cheap dish and
 * a low-volume expensive one are different answers, and the kitchen staff rota
 * cares about the second one. The count is still shown, because revenue alone
 * hides whether a dish sells to many people or to a few people ordering a lot.
 */

const currency = (v: number) => formatMoney(v);

/** Bar length relative to the leader, floored at 4% so the row is not blank. */
const width = (value: number, max: number) =>
  max > 0 ? `${Math.max(4, (value / max) * 100)}%` : "4%";

const Row = ({ item, rank, max }: { item: TopItem; rank: number; max: number }) => (
  <li className="flex items-center gap-3 py-2">
    <span
      className={`w-5 shrink-0 text-center text-xs font-black tabular-nums ${
        rank <= 3 ? "text-primary" : "text-muted-foreground/50"
      }`}
    >
      {rank}
    </span>

    {item.image ? (
      <img
        src={item.image}
        alt=""
        className="size-9 rounded-md object-cover shrink-0"
      />
    ) : (
      <div className="size-9 rounded-md bg-muted shrink-0" />
    )}

    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold truncate">{item.name}</span>
        {/* A dish pulled from the menu still has earnings in the period. Flag
            it rather than dropping the row — deleting the row would quietly
            falsify the ranking. */}
        {!item.isAvailable && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {item.name === "Deleted item" ? "deleted" : "hidden"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: width(item.revenue, max) }}
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
        {item.category} · {item.quantity} sold
      </p>
    </div>

    <span className="text-sm font-black tabular-nums shrink-0">
      {currency(item.revenue)}
    </span>
  </li>
);

export default function TopItems() {
  const { data, isLoading } = useQuery({
    queryKey: qk.analytics.all,
    // Shares the cache entry with SalesHeatmap (one twelve-week aggregation for
    // both panels) and takes its own view with `select`. See the note in
    // SalesHeatmap — returning the slice from the queryFn instead would make
    // the two observers overwrite each other.
    queryFn: async () => (await getSalesAnalytics()).data,
    select: (payload) => payload.topItems,
    refetchInterval: SAFETY_POLL_MS,
  });

  if (isLoading || !data) {
    return <Skeleton className="h-96 rounded-lg w-full" />;
  }

  const max = data[0]?.revenue ?? 0;

  return (
    <div className="bg-white dark:bg-card rounded-lg p-6 shadow-sm border border-border flex flex-col">
      <div className="mb-2">
        <h2 className="text-lg font-bold text-foreground tracking-tight">
          Top sellers
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          By revenue, same 12-week window
        </p>
      </div>

      {data.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground py-12">
          <p className="text-sm font-medium">No sales to rank yet</p>
        </div>
      ) : (
        <ol className="divide-y flex-1">
          {data.map((item, i) => (
            <Row key={item.id} item={item} rank={i + 1} max={max} />
          ))}
        </ol>
      )}
    </div>
  );
}

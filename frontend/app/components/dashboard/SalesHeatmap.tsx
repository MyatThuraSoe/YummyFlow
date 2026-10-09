import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { getSalesAnalytics, type SalesHeatmap as HeatmapData } from "@/lib/api";
import { qk, SAFETY_POLL_MS } from "@/lib/query-keys";
import { formatMoney } from "@/lib/currency";

/**
 * Trading-hours heatmap: weekday rows, hour columns, revenue per cell.
 *
 * Deliberately a CSS grid rather than a charting-library series. Recharts
 * draws axes and paths, and a heatmap is 168 labelled rectangles — as a chart
 * it would need per-cell custom shapes anyway, and would end up less legible
 * than just laying them out. The grid also gives a free title on each cell and
 * costs nothing to scroll.
 */

/** Only hours a restaurant realistically trades, to keep the grid readable. */
const FIRST_HOUR = 6;
const LAST_HOUR = 23;

/** Five steps of one hue, light → dark. A sequential ramp, not a rainbow. */
const STEPS = [
  "bg-muted",
  "bg-primary/20",
  "bg-primary/40",
  "bg-primary/65",
  "bg-primary",
] as const;

const formatCurrency = (v: number) => formatMoney(v, { compact: true });

const hourLabel = (h: number) => {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h > 12 ? `${h - 12}p` : `${h}a`;
};

const stepFor = (revenue: number, max: number) => {
  if (revenue <= 0) return 0;
  // The top band starts at half of max, otherwise a single huge Friday dinner
  // would push every other cell into bucket 1 and the whole week would read
  // as "empty".
  const ratio = revenue / (max || 1);
  if (ratio > 0.66) return 4;
  if (ratio > 0.33) return 3;
  if (ratio > 0.12) return 2;
  return 1;
};

const Legend = ({ max }: { max: number }) => (
  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
    <span>quiet</span>
    {STEPS.map((step, i) => (
      <span
        key={i}
        // `aria-hidden` because the ramp is already described in the caption;
        // announcing five identical squares helps nobody.
        aria-hidden
        className={`size-3.5 rounded-sm ${step}`}
      />
    ))}
    <span>busy · up to {formatCurrency(max)}</span>
  </div>
);

export default function SalesHeatmap() {
  const { data, isLoading } = useQuery({
    queryKey: qk.analytics.all,
    // Fetch the WHOLE payload and let `select` take the slice.
    //
    // Returning `data.heatmap` from the queryFn would share one cache entry
    // with TopItems — which returns `data.topItems` — and TanStack keys on the
    // queryKey alone, so whichever observer won the race would write the entry
    // and the other would read the wrong shape. That panel's guard
    // (`!data`) then held forever and it sat on a skeleton for the life of the
    // page. `select` is the mechanism for different views of one cache entry.
    queryFn: async () => (await getSalesAnalytics()).data,
    select: (payload) => payload.heatmap,
    // Trading pattern is historical: it does not change because an order just
    // landed, so a long safety net and no aggressive polling.
    refetchInterval: SAFETY_POLL_MS,
  });

  if (isLoading || !data) {
    return <Skeleton className="h-80 rounded-lg w-full" />;
  }

  const heatmap: HeatmapData = data;

  const hours = heatmap.days[0]?.hours ?? [];
  const shown = hours.filter((h) => h >= FIRST_HOUR && h <= LAST_HOUR);

  return (
    <div className="bg-white dark:bg-card rounded-lg p-6 shadow-sm border border-border">
      <div className="flex justify-between items-start gap-4 flex-wrap mb-1">
        <div>
          <h2 className="text-lg font-bold text-foreground tracking-tight">
            When you sell
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Revenue by day and hour, last {heatmap.weeks} weeks
          </p>
        </div>
        {heatmap.peak.revenue > 0 && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Busiest slot</p>
            <p className="text-sm font-bold text-foreground">
              {heatmap.peak.day}s at {hourLabel(heatmap.peak.hour)} ·{" "}
              {formatCurrency(heatmap.peak.revenue)}
            </p>
          </div>
        )}
      </div>

      <div className="mt-5 overflow-x-auto">
        <div
          className="min-w-[38rem]"
          style={{
            display: "grid",
            gridTemplateColumns: `2.25rem repeat(${shown.length}, minmax(0, 1fr))`,
            gap: "2px",
          }}
        >
          {/* Header row: only label every third hour. 24 labels across the
              width collide, and half-hour precision is not a question anyone
              asks of a heatmap. */}
          <div />
          {shown.map((h) => (
            <div
              key={h}
              className="text-center text-[9px] text-muted-foreground pb-1 tabular-nums"
            >
              {h % 3 === 0 ? hourLabel(h) : ""}
            </div>
          ))}

          {heatmap.days.map((day) => {
            const dayTotal = day.revenue.reduce((s, v) => s + v, 0);
            return (
              <div key={day.day} className="contents">
                <div
                  className="flex items-center text-[10px] font-bold text-muted-foreground pr-1"
                  title={`${day.day}: ${formatCurrency(dayTotal)}`}
                >
                  {day.day}
                </div>
                {shown.map((h) => {
                  const idx = day.hours.indexOf(h);
                  const revenue = idx === -1 ? 0 : (day.revenue[idx] ?? 0);
                  const orders = idx === -1 ? 0 : (day.orders[idx] ?? 0);
                  const step = stepFor(revenue, heatmap.maxRevenue);

                  return (
                    <div
                      key={h}
                      // Both numbers on the title, because a cell's colour
                      // only answers "how busy" — the manager reading this
                      // wants the money and the covers behind that.
                      title={`${day.day} ${hourLabel(h)} — ${formatCurrency(revenue)} · ${orders} ${orders === 1 ? "order" : "orders"}`}
                      className={`aspect-square rounded-sm ${STEPS[step]} transition-colors`}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex justify-between items-center gap-4 flex-wrap">
        <Legend max={heatmap.maxRevenue} />
        {heatmap.maxRevenue === 0 && (
          <p className="text-xs text-muted-foreground">
            No paid orders in this window yet.
          </p>
        )}
      </div>
    </div>
  );
}

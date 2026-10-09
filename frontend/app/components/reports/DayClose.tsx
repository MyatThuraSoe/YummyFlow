import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Printer,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { qk, SAFETY_POLL_MS } from "@/lib/query-keys";
import { getDayClose, type DayCloseReport } from "@/lib/api";
import { usePrint } from "@/components/receipt/Receipt";
import { formatMoney as money } from "@/lib/currency";

/**
 * Service-day close — the Z report a manager runs at the end of a shift.
 *
 * The dashboard answers "how are we doing"; this answers "can I cash up and go
 * home". It is built around one question: is anything still unresolved? The
 * blocker banner is therefore the first thing on the page, not a footnote.
 *
 * NOTE: the service day is cut in UTC, matching the aggregation the dashboard
 * uses. Showing local days here while the charts used UTC would mean the two
 * screens disagreed about which day a late order belonged to.
 */

const utcToday = () => new Date().toISOString().slice(0, 10);

const shiftDay = (key: string, days: number) => {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const prettyDate = (key: string) =>
  new Date(`${key}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const prettyHour = (hour: number) => {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
};

const humanise = (value: string) =>
  value.replace(/[_-]+/g, " ").toLowerCase();

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    default: "text-foreground",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
  }[tone];

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 text-xl font-black tabular-nums", toneClass)}>
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export default function DayClose() {
  const [date, setDate] = useState(utcToday);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: qk.reports.dayClose(date),
    queryFn: () => getDayClose(date),
    // Socket events do not touch a settled day, so this is a slow backstop only.
    refetchInterval: SAFETY_POLL_MS,
  });

  const report: DayCloseReport | undefined = data?.data;

  const { receiptRef, print } = usePrint({
    documentTitle: () => `Z-Report-${date}`,
  });

  const peakHour = useMemo(() => {
    if (!report?.hourly.length) return null;
    return report.hourly.reduce((best, row) =>
      row.orders > best.orders ? row : best,
    );
  }, [report]);

  const maxHourly = useMemo(
    () => Math.max(1, ...(report?.hourly.map((h) => h.orders) ?? [1])),
    [report],
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">
            Day Close
          </h1>
          <p className="mt-0.5 text-sm font-medium text-muted-foreground">
            {prettyDate(date)}
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
              UTC service day
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setDate((d) => shiftDay(d, -1))}
            className="rounded-lg border border-border p-2 text-foreground hover:bg-muted"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground"
          />
          <button
            type="button"
            aria-label="Next day"
            onClick={() => setDate((d) => shiftDay(d, 1))}
            className="rounded-lg border border-border p-2 text-foreground hover:bg-muted"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setDate(utcToday())}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
            Refresh
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={() => setTimeout(() => print(), 100)}
            className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            Print Z report
          </button>
        </div>
      </header>

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          Could not build the day-close report. Check the connection and retry.
        </div>
      )}

      {isLoading || !report ? (
        !isError && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl border border-border bg-card/60"
              />
            ))}
          </div>
        )
      ) : (
        <>
          {/* Can this shift actually be signed off? */}
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl border p-4",
              report.closed
                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
            )}
          >
            {report.closed ? (
              <CheckCircle2 className="mt-0.5 w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="mt-0.5 w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
            )}
            <div>
              <p
                className={cn(
                  "text-sm font-black uppercase tracking-wide",
                  report.closed
                    ? "text-emerald-800 dark:text-emerald-300"
                    : "text-amber-800 dark:text-amber-300",
                )}
              >
                {report.closed
                  ? "Clear to close"
                  : `${report.blockers.length} thing${
                      report.blockers.length === 1 ? "" : "s"
                    } still open`}
              </p>
              {report.closed ? (
                <p className="mt-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Every order is settled and every table is free.
                </p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {report.blockers.map((b) => (
                    <li
                      key={b}
                      className="text-sm font-semibold text-amber-800 dark:text-amber-300"
                    >
                      · {b}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Money */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat
              label="Collected"
              value={money(report.revenue.collected)}
              hint={`${report.orders.paid} paid orders`}
              tone="good"
            />
            <Stat
              label="Gross"
              value={money(report.revenue.gross)}
              hint="all non-void orders"
            />
            <Stat
              label="Outstanding"
              value={money(report.revenue.outstanding)}
              hint="not yet paid"
              tone={report.revenue.outstanding > 0 ? "warn" : "default"}
            />
            <Stat
              label="Voids"
              value={money(report.revenue.voided)}
              hint={`${report.orders.cancelled} cancelled`}
              tone={report.revenue.voided > 0 ? "bad" : "default"}
            />
            <Stat
              label="Orders"
              value={String(report.orders.total)}
              hint={`${report.orders.open} still open`}
            />
            <Stat
              label="Average ticket"
              value={money(report.orders.averageTicket)}
              hint="per paid order"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Till reconciliation — the part that has to match the drawer. */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
                Payments
              </h2>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                What each method took today.
              </p>
              {report.payments.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No payments recorded.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {report.payments.map((p) => (
                    <li
                      key={p.method}
                      className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2"
                    >
                      <span className="text-sm font-bold uppercase text-foreground">
                        {humanise(p.method)}
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground">
                        {p.count}×
                      </span>
                      <span className="text-sm font-black tabular-nums text-foreground">
                        {money(p.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* How the orders left the building. */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
                Order mix
              </h2>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                Covers by service type.
              </p>
              {report.orders.byType.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No orders today.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {report.orders.byType.map((t) => (
                    <li
                      key={t.type}
                      className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2"
                    >
                      <span className="text-sm font-bold uppercase text-foreground">
                        {humanise(t.type)}
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground">
                        {t.count} order{t.count === 1 ? "" : "s"}
                      </span>
                      <span className="text-sm font-black tabular-nums text-foreground">
                        {money(t.revenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Trading pattern — did staffing match the rush? */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
                Trading pattern
              </h2>
              {peakHour && (
                <p className="text-xs font-semibold text-muted-foreground">
                  Peak {prettyHour(peakHour.hour)} · {peakHour.orders} orders ·{" "}
                  {money(peakHour.revenue)}
                </p>
              )}
            </div>

            {report.hourly.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Nothing traded today.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {report.hourly.map((h) => (
                  <li key={h.hour} className="flex items-center gap-3">
                    <span className="w-12 shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">
                      {prettyHour(h.hour)}
                    </span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded bg-primary"
                        style={{
                          width: `${Math.max(
                            4,
                            (h.orders / maxHourly) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-[11px] font-bold tabular-nums text-foreground">
                      {h.orders}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {money(h.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Where the money came from, ranked by revenue. */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
                Top sellers
              </h2>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                Ranked by revenue, not volume.
              </p>
              {report.items.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Nothing sold today.
                </p>
              ) : (
                <ol className="mt-3 space-y-1.5">
                  {report.items.map((item, i) => (
                    <li
                      key={item.name}
                      className="flex items-center gap-3 rounded-lg px-2 py-1.5 odd:bg-muted/60"
                    >
                      <span className="w-5 shrink-0 text-xs font-black text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                        {item.name}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                        {item.quantity} sold
                      </span>
                      <span className="w-20 shrink-0 text-right text-sm font-black tabular-nums text-foreground">
                        {money(item.revenue)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Voids — a total nobody can explain is worse than no total. */}
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
                Voids
              </h2>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                Cancelled orders, newest first.
              </p>
              {report.voids.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No voids today.
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {report.voids.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center gap-3 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/20"
                    >
                      <span className="font-mono text-xs font-black text-foreground">
                        #{v.id.slice(-6).toUpperCase()}
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground">
                        {v.tableName ? `Table ${v.tableName}` : humanise(v.orderType)}
                      </span>
                      <span className="ml-auto text-[11px] font-medium text-muted-foreground">
                        {new Date(v.createdAt).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="w-20 shrink-0 text-right text-sm font-black tabular-nums text-red-700 dark:text-red-400">
                        −{money(v.totalAmount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* End-of-day state of the floor and the book. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
                Floor
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Tables" value={String(report.tables.total)} />
                <Stat
                  label="Occupied"
                  value={String(report.tables.occupied)}
                  tone={report.tables.occupied > 0 ? "warn" : "good"}
                />
                <Stat
                  label="Cleaning"
                  value={String(report.tables.cleaning)}
                  tone={report.tables.cleaning > 0 ? "warn" : "default"}
                />
                <Stat label="Seats" value={String(report.tables.seats)} />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-black uppercase tracking-wide text-foreground">
                Bookings
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Bookings" value={String(report.reservations.total)} />
                <Stat label="Guests" value={String(report.reservations.guests)} />
                <Stat
                  label="Pending"
                  value={String(report.reservations.pending)}
                  tone={report.reservations.pending > 0 ? "warn" : "default"}
                />
                <Stat
                  label="Completed"
                  value={String(report.reservations.completed)}
                />
              </div>
            </section>
          </div>

          {/* ================================================== */}
          {/* HIDDEN PRINT UI — A4 Z report, always black on white */}
          {/* ================================================== */}
          <div
            style={{ position: "absolute", left: "-9999px", top: 0 }}
            aria-hidden="true"
          >
            <div
              ref={receiptRef}
              className="w-[210mm] bg-white p-10 font-sans text-[12px] text-black"
            >
              <div className="mb-6 border-b-2 border-black pb-4">
                <h1 className="text-2xl font-black uppercase">
                  Dine Flow — Z Report
                </h1>
                <p className="mt-1 text-sm">
                  Service day {date} (UTC) · printed{" "}
                  {new Date().toLocaleString("en-US", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
                <p className="mt-1 text-sm font-bold uppercase">
                  {report.closed
                    ? "Status: clear to close"
                    : `Status: ${report.blockers.length} unresolved — ${report.blockers.join("; ")}`}
                </p>
              </div>

              <table className="w-full text-[12px]">
                <tbody>
                  {[
                    ["Collected", money(report.revenue.collected)],
                    ["Gross", money(report.revenue.gross)],
                    ["Outstanding", money(report.revenue.outstanding)],
                    ["Voids", money(report.revenue.voided)],
                    ["Orders", String(report.orders.total)],
                    ["Paid orders", String(report.orders.paid)],
                    ["Average ticket", money(report.orders.averageTicket)],
                  ].map(([label, value]) => (
                    <tr key={label} className="border-b border-gray-300">
                      <td className="py-1.5 font-semibold">{label}</td>
                      <td className="py-1.5 text-right font-bold tabular-nums">
                        {value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2 className="mt-6 mb-2 text-sm font-black uppercase">
                Payments
              </h2>
              <table className="w-full text-[12px]">
                <tbody>
                  {report.payments.map((p) => (
                    <tr key={p.method} className="border-b border-gray-300">
                      <td className="py-1.5 font-semibold uppercase">
                        {p.method}
                      </td>
                      <td className="py-1.5 text-right">{p.count}×</td>
                      <td className="py-1.5 text-right font-bold tabular-nums">
                        {money(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2 className="mt-6 mb-2 text-sm font-black uppercase">
                Top sellers
              </h2>
              <table className="w-full text-[12px]">
                <tbody>
                  {report.items.map((item) => (
                    <tr key={item.name} className="border-b border-gray-300">
                      <td className="py-1.5">{item.name}</td>
                      <td className="py-1.5 text-right">{item.quantity}×</td>
                      <td className="py-1.5 text-right font-bold tabular-nums">
                        {money(item.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {report.voids.length > 0 && (
                <>
                  <h2 className="mt-6 mb-2 text-sm font-black uppercase">
                    Voids
                  </h2>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {report.voids.map((v) => (
                        <tr key={v.id} className="border-b border-gray-300">
                          <td className="py-1.5 font-mono">
                            #{v.id.slice(-6).toUpperCase()}
                          </td>
                          <td className="py-1.5">
                            {v.tableName ? `Table ${v.tableName}` : v.orderType}
                          </td>
                          <td className="py-1.5 text-right font-bold tabular-nums">
                            −{money(v.totalAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <div className="mt-10 flex gap-16 text-[12px]">
                <div className="flex-1 border-t border-black pt-1">
                  Manager signature
                </div>
                <div className="flex-1 border-t border-black pt-1">
                  Cash counted by
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

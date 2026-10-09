import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  Lightbulb,
  ListChecks,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/currency";
import {
  generateBriefing,
  getLatestBriefings,
  type Briefing,
  type BriefingAction,
} from "@/lib/api";
import { qk, SAFETY_POLL_MS } from "@/lib/query-keys";

type Tab = "EXECUTIVE" | "FORECAST";

const PRIORITY_STYLE: Record<BriefingAction["priority"], string> = {
  HIGH: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  LOW: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
};

export default function AiBriefing() {
  const [tab, setTab] = useState<Tab>("EXECUTIVE");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: qk.briefings.latest,
    queryFn: getLatestBriefings,
    // Reads the cached briefing only — never triggers a Gemini call.
    refetchInterval: SAFETY_POLL_MS,
  });

  const mutation = useMutation({
    mutationFn: (kind: Tab) => generateBriefing(kind),
    onSuccess: (res) => {
      toast.success("Briefing generated");
      // Seed the cache with the briefing we just got back so the panel updates
      // instantly, then refresh the metrics rollup that sits alongside it.
      queryClient.setQueryData(
        qk.briefings.latest,
        (prev: Awaited<ReturnType<typeof getLatestBriefings>> | undefined) => ({
          data: {
            executive: prev?.data?.executive ?? null,
            forecast: prev?.data?.forecast ?? null,
            [res.data.kind === "EXECUTIVE" ? "executive" : "forecast"]: res.data,
          },
        }),
      );
      queryClient.invalidateQueries({ queryKey: qk.briefings.metrics });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to generate briefing"),
  });

  const briefing: Briefing | null | undefined =
    tab === "EXECUTIVE" ? data?.data?.executive : data?.data?.forecast;

  return (
    <div className="bg-white dark:bg-card rounded-lg shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
      {/* ---------------- header ---------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-500/20 text-violet-600 flex items-center justify-center shrink-0">
            <BrainCircuit className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
              AI Briefing
              <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                Pro
              </span>
            </h2>
            <p className="text-xs font-medium text-slate-500 mt-0.5">
              {briefing
                ? `Generated ${new Date(briefing.createdAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })} · ${briefing.payload?.generatedBy === "gemini" ? briefing.model : "analytics engine"}`
                : "Executive digest and 7-day demand forecast"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-slate-100 dark:bg-slate-800 p-1">
            {(["EXECUTIVE", "FORECAST"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-3 py-1.5 text-xs font-bold rounded-full transition-colors",
                  tab === t
                    ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300",
                )}
              >
                {t === "EXECUTIVE" ? "Executive" : "Forecast"}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(tab)}
          >
            <RefreshCw
              className={cn("w-4 h-4", mutation.isPending && "animate-spin")}
            />
            <span className="hidden sm:inline">
              {mutation.isPending ? "Generating…" : "Regenerate"}
            </span>
          </Button>
        </div>
      </div>

      {/* ---------------- body ---------------- */}
      {isLoading ? (
        <div className="p-6 space-y-4">
          <Skeleton className="h-7 w-2/3 rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        </div>
      ) : !briefing ? (
        <EmptyBriefing
          tab={tab}
          busy={mutation.isPending}
          onGenerate={() => mutation.mutate(tab)}
        />
      ) : (
        <div className="p-6 space-y-6">
          <HeadlineBlock briefing={briefing} />

          {briefing.payload?.highlights?.length ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {briefing.payload.highlights.map((h) => (
                <HighlightTile key={h.label} {...h} />
              ))}
            </div>
          ) : null}

          {tab === "FORECAST" && briefing.payload?.forecast?.points?.length ? (
            <ForecastChart points={briefing.payload.forecast.points} />
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section
              icon={Lightbulb}
              title="Insights"
              tone="text-amber-600 bg-amber-100 dark:bg-amber-500/20"
              items={briefing.payload?.insights ?? []}
            />
            <Section
              icon={AlertTriangle}
              title="Risks"
              tone="text-red-600 bg-red-100 dark:bg-red-500/20"
              items={briefing.payload?.risks ?? []}
            />
          </div>

          {briefing.payload?.actions?.length ? (
            <div>
              <SectionHeading
                icon={ListChecks}
                title="Recommended actions"
                tone="text-emerald-600 bg-emerald-100 dark:bg-emerald-500/20"
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                {briefing.payload.actions.map((a, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-slate-100 dark:border-slate-800 p-4 flex flex-col gap-2 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-bold text-sm text-slate-800 dark:text-white">
                        {a.title}
                      </h4>
                      <span
                        className={cn(
                          "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0",
                          PRIORITY_STYLE[a.priority] ?? PRIORITY_STYLE.MEDIUM,
                        )}
                      >
                        {a.priority}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{a.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function HeadlineBlock({ briefing }: { briefing: Briefing }) {
  return (
    <div className="rounded-lg bg-gradient-to-r from-violet-50 to-transparent dark:from-violet-500/10 p-5 border border-violet-100 dark:border-violet-500/20">
      <div className="flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-violet-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-base md:text-lg font-black text-slate-800 dark:text-white tracking-tight">
            {briefing.headline}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
            {briefing.summary}
          </p>
        </div>
      </div>
    </div>
  );
}

function HighlightTile({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta: number | null;
}) {
  const hasDelta = typeof delta === "number";
  const isUp = hasDelta && delta! >= 0;
  return (
    <div className="rounded-lg border border-slate-100 dark:border-slate-800 p-4">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
        {label}
      </p>
      <div className="flex items-end justify-between gap-2 mt-2">
        <span className="text-xl font-black text-slate-800 dark:text-white tracking-tight">
          {value}
        </span>
        {hasDelta ? (
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs font-bold",
              isUp ? "text-emerald-500" : "text-red-500",
            )}
          >
            {isUp ? (
              <ArrowUpRight className="w-3 h-3" />
            ) : (
              <ArrowDownRight className="w-3 h-3" />
            )}
            {isUp ? "+" : ""}
            {delta}%
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ForecastChart({
  points,
}: {
  points: {
    weekday: string;
    date: string;
    predictedRevenue: number;
    predictedOrders: number;
    confidence: number;
  }[];
}) {
  const max = Math.max(...points.map((p) => p.predictedRevenue), 1);
  return (
    <div>
      <SectionHeading
        icon={TrendingUp}
        title="7-day demand forecast"
        tone="text-blue-600 bg-blue-100 dark:bg-blue-500/20"
      />
      <div className="h-56 w-full mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="weekday"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "#64748b" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "#64748b" }}
              tickFormatter={(v: number) => formatMoney(v, { compact: true })}
            />
            <Tooltip
              cursor={{ fill: "rgba(148,163,184,0.12)" }}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                fontSize: 12,
                background: "#ffffff",
                color: "#0f172a",
              }}
              formatter={(value, _name, item) => [
                `${formatMoney(value as number)} · ~${item?.payload?.predictedOrders} orders · ${item?.payload?.confidence}% confidence`,
                item?.payload?.date,
              ]}
            />
            <Bar dataKey="predictedRevenue" radius={[6, 6, 0, 0]}>
              {points.map((p, i) => (
                <Cell
                  key={i}
                  fill={p.predictedRevenue >= max ? "#8b5cf6" : "#c4b5fd"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  tone,
}: {
  icon: any;
  title: string;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
          tone,
        )}
      >
        <Icon className="w-4 h-4" />
      </div>
      <h4 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-widest">
        {title}
      </h4>
    </div>
  );
}

function Section({
  icon,
  title,
  tone,
  items,
}: {
  icon: any;
  title: string;
  tone: string;
  items: string[];
}) {
  if (!items.length) return null;
  return (
    <div>
      <SectionHeading icon={icon} title={title} tone={tone} />
      <ul className="mt-3 space-y-2">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mt-2 shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyBriefing({
  tab,
  busy,
  onGenerate,
}: {
  tab: Tab;
  busy: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="p-10 flex flex-col items-center text-center gap-4">
      <div className="w-14 h-14 rounded-full bg-violet-100 dark:bg-violet-500/20 text-violet-600 flex items-center justify-center">
        <BrainCircuit className="w-7 h-7" />
      </div>
      <div>
        <h3 className="font-bold text-slate-800 dark:text-white">
          No {tab === "EXECUTIVE" ? "executive briefing" : "forecast"} yet
        </h3>
        <p className="text-sm text-slate-500 mt-1 max-w-md">
          Generate one now — DineFlow analyses revenue, orders, occupancy and menu
          health, then writes the summary. A daily digest is also produced
          automatically each morning.
        </p>
      </div>
      <Button
        onClick={onGenerate}
        disabled={busy}
        className="rounded-full bg-violet-600 hover:bg-violet-700 text-white"
      >
        <Sparkles className={cn("w-4 h-4", busy && "animate-pulse")} />
        {busy ? "Generating…" : "Generate briefing"}
      </Button>
    </div>
  );
}

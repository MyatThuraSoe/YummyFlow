import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  ShoppingBag,
  UtensilsCrossed,
  Coffee,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { customFetch } from "@/lib/api";
import { qk, SAFETY_POLL_MS } from "@/lib/query-keys";
import { formatMoney } from "@/lib/currency";

interface stats {
  revenue: {
    value: number;
    trend: number;
  };
  orders: {
    value: number;
    trend: number;
  };
  dineIn: {
    value: number;
    trend: number;
  };
  takeAway: {
    value: number;
    trend: number;
  };
}

export default function StatsCards() {
  const {
    data: stats,
    isLoading,
    isError,
  } = useQuery({
    queryKey: qk.dashboard.stats,
    queryFn: () => customFetch<stats>("/dashboard/stats"),
    // Socket events refresh this through the throttled aggregate lane. The poll
    // is only a backstop for a dropped connection — it used to run every 60s.
    refetchInterval: SAFETY_POLL_MS,
  });
  // console.log(stats);
  if (isLoading || isError || !stats) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-white dark:bg-card rounded-lg p-6 border border-border shadow-sm"
          >
            <div className="flex justify-between items-center mb-4">
              <Skeleton className="h-4 w-20 rounded-md" />
              <Skeleton className="h-4 w-12 rounded-md" />
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="w-12 h-12 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
      {/* Format as KES or USD depending on your preference */}
      <KPICard
        title="Revenue"
        value={formatMoney(stats.revenue.value)}
        trend={stats.revenue.trend}
        icon={DollarSign}
        color="text-orange-500"
        bg="bg-orange-100 dark:bg-orange-500/20"
      />
      <KPICard
        title="Total Orders"
        value={stats.orders.value.toString()}
        trend={stats.orders.trend}
        icon={ShoppingBag}
        color="text-emerald-500"
        bg="bg-emerald-100 dark:bg-emerald-500/20"
      />
      <KPICard
        title="Dine In"
        value={stats.dineIn.value.toString()}
        trend={stats.dineIn.trend}
        icon={UtensilsCrossed}
        color="text-red-500"
        bg="bg-red-100 dark:bg-red-500/20"
      />
      <KPICard
        title="Take Away"
        value={stats.takeAway.value.toString()}
        trend={stats.takeAway.trend}
        icon={Coffee}
        color="text-amber-500"
        bg="bg-amber-100 dark:bg-amber-500/20"
      />
    </div>
  );
}

function KPICard({ title, value, trend, icon: Icon, color, bg }: any) {
  const isUp = trend >= 0;
  const displayTrend = `${isUp ? "+" : ""}${trend}%`;
  return (
    <div className="bg-white dark:bg-card rounded-lg p-6 shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col justify-between transition-all hover:shadow-md">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">
          {title}
        </h3>
        <div
          className={cn(
            "flex items-center gap-1 text-xs font-bold",
            isUp ? "text-emerald-500" : "text-red-500",
          )}
        >
          {isUp ? (
            <ArrowUpRight className="w-3 h-3" />
          ) : (
            <ArrowDownRight className="w-3 h-3" />
          )}
          {displayTrend}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center shrink-0",
            bg,
            color,
          )}
        >
          <Icon className="w-6 h-6" />
        </div>
        <span className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white tracking-tight">
          {value}
        </span>
      </div>
    </div>
  );
}

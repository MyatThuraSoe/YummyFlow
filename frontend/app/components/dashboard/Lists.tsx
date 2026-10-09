import { useQuery } from "@tanstack/react-query";
import { ArrowRight, UtensilsCrossed, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router";
import { customFetch } from "@/lib/api";
import { qk, SAFETY_POLL_MS } from "@/lib/query-keys";

interface ListsProps {
  trendingDishes: {
    id: string;
    name: string;
    image: string | null;
    orders: number;
  }[];
  outOfStock: { id: string; name: string; image: string | null }[];
}

export default function Lists() {
  const { data: lists, isLoading } = useQuery({
    queryKey: qk.dashboard.lists,
    queryFn: () => customFetch<ListsProps>("/dashboard/lists"),
    // Socket-driven via the throttled aggregate lane; 5-minute safety net only.
    refetchInterval: SAFETY_POLL_MS,
  });

  if (isLoading || !lists) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-75 rounded-lg w-full" />
        <Skeleton className="h-75 rounded-lg w-full" />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* ================================================================== */}
      {/* TRENDING DISHES (PAST 7 DAYS) */}
      {/* ================================================================== */}
      <div className="bg-white dark:bg-card rounded-lg p-6 shadow-sm border border-border flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold text-foreground tracking-tight">
            Trending Items (7d)
          </h2>
          <Link
            to="/admin/menu"
            className="text-xs font-bold uppercase tracking-widest text-orange-500 flex items-center gap-1 hover:text-orange-600 transition-colors"
          >
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {lists.trendingDishes.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <p className="text-sm font-medium">
              No sales data from the last 7 days.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {lists.trendingDishes.map((dish) => (
              <div
                key={dish.id}
                className="flex items-center gap-4 p-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-muted/50 transition-colors border border-transparent hover:border-border"
              >
                <div className="w-12 h-12 bg-orange-50 dark:bg-orange-500/10 rounded-xl flex items-center justify-center overflow-hidden shrink-0 shadow-sm border border-orange-100 dark:border-orange-500/20">
                  {dish.image ? (
                    <img
                      src={dish.image}
                      alt={dish.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <UtensilsCrossed className="w-5 h-5 text-orange-500" />
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <h4 className="font-bold text-sm text-foreground leading-tight truncate">
                    {dish.name}
                  </h4>
                  <p className="text-[10px] font-bold text-muted-foreground mt-1 uppercase tracking-wider">
                    Orders:{" "}
                    <span className="text-orange-500 ml-1">{dish.orders}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* ================================================================== */}
      {/* OUT OF STOCK ALERTS */}
      {/* ================================================================== */}
      <div className="bg-white dark:bg-card rounded-lg p-6 shadow-sm border border-border flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold text-foreground tracking-tight">
            Unavailable Items
          </h2>
          <Link
            to="/admin/menu"
            className="text-xs font-bold uppercase tracking-widest text-red-500 flex items-center gap-1 hover:text-red-600 transition-colors"
          >
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        {lists.outOfStock.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-2 rounded-full">
              All menu items are currently in stock! 🎉
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {lists.outOfStock.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-4 p-3 rounded-2xl bg-red-50/50 dark:bg-red-500/5 border border-red-100 dark:border-red-900/30"
              >
                <div className="w-12 h-12 bg-white dark:bg-card rounded-xl flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="w-full h-full object-cover grayscale opacity-80"
                    />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <h4 className="font-bold text-sm text-foreground leading-tight truncate">
                    {item.name}
                  </h4>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-1">
                    Status:{" "}
                    <span className="text-red-500 ml-1">Draft / Empty</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

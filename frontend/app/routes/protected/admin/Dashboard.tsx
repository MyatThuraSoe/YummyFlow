import StatsCards from "@/components/dashboard/StatsCards";
import type { Route } from "./+types/Dashboard";
import Charts from "@/components/dashboard/Charts";
import Lists from "@/components/dashboard/Lists";
import AiBriefing from "@/components/dashboard/AiBriefing";
import SalesHeatmap from "@/components/dashboard/SalesHeatmap";
import TopItems from "@/components/dashboard/TopItems";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Dashboard" },
    { name: "description", content: "Welcome to the Dashboard!" },
  ];
}

const Dashboard = () => {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="p-6 md:p-8 min-h-screen space-y-6">
      {/* ================================================================== */}
      {/* HEADER */}
      {/* ================================================================== */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white tracking-tight">
            Dine Flow Overview
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-1">{today}</p>
        </div>
        {/* <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search category, menu, or order..."
            className="pl-10 bg-white dark:bg-card border-none shadow-sm rounded-full h-11"
          />
        </div> */}
      </div>
      <StatsCards />
      <AiBriefing />
      <Charts />
      {/* Heatmap takes the full width: 24 columns of hour labels are unreadable
          at half width, and the pattern across a week is the whole point. */}
      <SalesHeatmap />
      <Lists />
      <TopItems />
    </div>
  );
};

export default Dashboard;

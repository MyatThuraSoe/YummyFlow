import { customFetch } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import type { ActivitiesLog, PaginatedResponseProps } from "@/type";
import { formatDistanceToNow } from "date-fns";
import { Activity, Clock, Loader2, History } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import CustomPagination from "@/components/global/CustomPagination";
import { useState } from "react";
import type { Route } from "../+types/layout";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Activities Log" },
    {
      name: "description",
      content: "View the activity log for all system events.",
    },
  ];
}

const ActivitiesLogs = () => {
  const [page, setPage] = useState(1);
  const { data: activitiesLog, isLoading } = useQuery({
    queryKey: ["activitiesLog", page],
    queryFn: () =>
      customFetch<PaginatedResponseProps<ActivitiesLog>>(
        `/activities-log?page=${page}`,
      ),
  });

  return (
    <div className="p-4 mx-auto w-full">
      <Card className="border-border shadow-sm bg-white dark:bg-card rounded-lg overflow-hidden h-[96vh]">
        <CardHeader className="border-b border-border bg-slate-50/50 dark:bg-muted/20 pb-6">
          <div className="flex justify-between w-full">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 text-primary rounded-xl">
                <History className="w-6 h-6" />
              </div>
              <div>
                <CardTitle className="text-2xl font-black uppercase tracking-tight">
                  Activity Log
                </CardTitle>
                <CardDescription className="text-sm font-medium mt-1">
                  A timeline of recent system events and user actions.
                </CardDescription>
              </div>
            </div>
            <CustomPagination
              currentPage={activitiesLog?.currentPage || 1}
              totalPages={activitiesLog?.totalPages || 1}
              loading={isLoading}
              setPage={setPage}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
              <p className="font-semibold text-sm">
                Loading activity history...
              </p>
            </div>
          ) : activitiesLog?.totalItems === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Activity className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-4" />
              <h3 className="text-lg font-bold text-foreground">
                No Activities Found
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                There are no recorded events in the system yet.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[96vh] w-full p-6">
              {/* TIMELINE WRAPPER */}
              <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-4 space-y-8 pb-36">
                {activitiesLog?.data.map((log) => (
                  <div
                    key={log.id}
                    className="relative pl-8 animate-in fade-in slide-in-from-bottom-2 duration-500"
                  >
                    {/* Timeline Dot */}
                    <div className="absolute -left-2.25 top-1 w-4 h-4 rounded-full bg-primary ring-4 ring-white dark:ring-card shadow-sm" />

                    <div className="flex flex-col gap-1">
                      {/* Top Row: Activity Title & Timestamp */}
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <h4 className="text-sm font-bold text-foreground leading-tight">
                          {log.activity}
                        </h4>
                        <div className="flex items-center text-xs font-semibold text-muted-foreground shrink-0 bg-slate-100 dark:bg-muted px-2.5 py-1 rounded-md">
                          <Clock className="w-3 h-3 mr-1.5" />
                          {/* Wrap in try/catch safely or ensure valid ISO string */}
                          {log.createdAt
                            ? formatDistanceToNow(new Date(log.createdAt), {
                                addSuffix: true,
                              })
                            : "Unknown time"}
                        </div>
                      </div>
                      {/* Details Box (Only rendered if details exist) */}
                      {log.details && (
                        <div className="mt-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-xl p-3 text-sm text-slate-600 dark:text-slate-400 font-medium">
                          {log.details}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ActivitiesLogs;

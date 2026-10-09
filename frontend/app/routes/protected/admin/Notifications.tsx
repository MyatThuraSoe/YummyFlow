import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Mail,
  RefreshCw,
  Send,
  Smartphone,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import type { Route } from "./+types/Notifications";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getNotificationLog } from "@/lib/api";
import { qk, SAFETY_POLL_MS } from "@/lib/query-keys";
import {
  getPushState,
  sendTestNotification,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupport,
} from "@/lib/push";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Notifications" },
    { name: "description", content: "Email and browser push notification settings." },
  ];
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<PushSupport | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshState = async () => setState(await getPushState());

  useEffect(() => {
    refreshState();
  }, []);

  const { data: log, isLoading: logLoading } = useQuery({
    queryKey: qk.notificationLog,
    queryFn: () => getNotificationLog({ limit: 30 }),
    // This is an audit console, not a live operational screen: nothing here
    // changes moment to moment during service. It used to poll every 30s (120
    // requests/hour) purely to keep a debugging table warm. The Refresh button
    // and the post-test invalidation below cover the cases that actually matter.
    refetchInterval: SAFETY_POLL_MS,
  });

  const testMutation = useMutation({
    mutationFn: sendTestNotification,
    onSuccess: (res) => {
      const pushMsg = res.push.skipped
        ? `Push skipped — ${res.push.hint ?? "no subscribed device"}`
        : `Push sent to ${res.push.sent} device(s)${res.push.failed ? `, ${res.push.failed} failed` : ""}`;
      toast.success(`${pushMsg}. Email ${res.email.ok ? `rendered (${res.email.mode})` : "failed"}.`, {
        duration: 6000,
      });
      queryClient.invalidateQueries({ queryKey: qk.notificationLog });
    },
    onError: (e: Error) => toast.error(e.message || "Test failed"),
  });

  const handleToggle = async () => {
    setBusy(true);
    try {
      if (state?.subscribed) {
        const res = await unsubscribeFromPush();
        if (res.ok) toast.success("Notifications disabled on this device");
        else toast.error(res.error);
      } else {
        const res = await subscribeToPush();
        if (res.ok) toast.success("Notifications enabled on this device");
        else toast.error(res.error);
      }
      await refreshState();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 md:p-8 min-h-screen space-y-6">
      {/* ---------------- header ---------------- */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white tracking-tight">
            Notifications
          </h1>
          <p className="text-sm font-medium text-slate-500 mt-1">
            Email templates and browser push delivery
          </p>
        </div>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => {
            refreshState();
            queryClient.invalidateQueries({ queryKey: qk.notificationLog });
          }}
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---------------- push ---------------- */}
        <div className="bg-white dark:bg-card rounded-lg p-6 shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 flex items-center justify-center shrink-0">
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 dark:text-white">
                Browser push
              </h2>
              <p className="text-xs text-slate-500">
                Alerts for new orders, bookings and order status
              </p>
            </div>
          </div>

          {!state ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-full rounded-md" />
              <Skeleton className="h-6 w-2/3 rounded-md" />
              <Skeleton className="h-10 w-full rounded-full" />
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              <ul className="space-y-2.5 mb-6">
                <CheckRow
                  label="Browser supports Web Push"
                  ok={state.supported}
                  detail={state.supported ? undefined : state.reason}
                />
                <CheckRow
                  label="Secure context (https / localhost)"
                  ok={state.secureContext}
                  detail={state.secureContext ? undefined : state.reason}
                />
                <CheckRow
                  label="Server VAPID keys configured"
                  ok={state.serverEnabled}
                  detail={state.serverEnabled ? undefined : "Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY"}
                />
                <CheckRow
                  label="Permission granted"
                  ok={state.permission === "granted"}
                  detail={
                    state.permission === "denied"
                      ? "Blocked in browser settings — reset site permissions"
                      : state.permission === "default"
                        ? "Not asked yet"
                        : undefined
                  }
                />
                <CheckRow
                  label="This device is subscribed"
                  ok={state.subscribed}
                  detail={state.subscribed ? undefined : "Click enable below"}
                />
              </ul>

              <div className="mt-auto flex flex-wrap gap-3">
                <Button
                  onClick={handleToggle}
                  disabled={busy || !state.supported || !state.secureContext}
                  className={cn(
                    "rounded-full text-white",
                    state.subscribed
                      ? "bg-slate-600 hover:bg-slate-700"
                      : "bg-blue-600 hover:bg-blue-700",
                  )}
                >
                  <Smartphone className="w-4 h-4" />
                  {busy
                    ? "Working…"
                    : state.subscribed
                      ? "Disable on this device"
                      : "Enable on this device"}
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full"
                  disabled={testMutation.isPending}
                  onClick={() => testMutation.mutate()}
                >
                  <Send className={cn("w-4 h-4", testMutation.isPending && "animate-pulse")} />
                  Send test
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ---------------- email ---------------- */}
        <div className="bg-white dark:bg-card rounded-lg p-6 shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-600 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800 dark:text-white">
                Transactional email
              </h2>
              <p className="text-xs text-slate-500">
                Welcome, receipts, booking confirmations, account status
              </p>
            </div>
          </div>

          <ul className="space-y-2.5 mb-6">
            {[
              "Welcome — sent on signup",
              "Order receipt — sent when an order is placed",
              "Reservation confirmation — sent on booking",
              "Reservation status — sent on confirm / cancel / complete",
              "Account suspended / restored — sent on ban changes",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                {t}
              </li>
            ))}
          </ul>

          <div className="mt-auto rounded-lg bg-slate-50 dark:bg-slate-800/50 p-4">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {log?.totals
                ? `${log.totals.emailSent} email(s) delivered, ${log.totals.pushSent} push(es) delivered, ${log.totals.failed} failed.`
                : "Delivery statistics loading…"}
            </p>
            <p className="text-[11px] text-slate-400 mt-2">
              Without SMTP credentials emails are rendered to{" "}
              <code className="font-mono">backend/.mail-outbox/</code> instead of being
              sent — the full pipeline still runs.
            </p>
          </div>
        </div>
      </div>

      {/* ---------------- delivery log ---------------- */}
      <div className="bg-white dark:bg-card rounded-lg shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-bold text-slate-800 dark:text-white">Delivery log</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every email and push attempt, newest first
          </p>
        </div>

        {logLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : !log?.data?.length ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No notifications sent yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50">
                <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <th className="px-6 py-3">Channel</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Template</th>
                  <th className="px-6 py-3">Recipient</th>
                  <th className="px-6 py-3">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {log.data.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="px-6 py-3 font-bold text-slate-700 dark:text-slate-200">
                      {row.channel}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={cn(
                          "text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full",
                          row.status === "SENT"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                            : row.status === "FAILED"
                              ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
                        )}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-slate-500">
                      {row.template}
                    </td>
                    <td className="px-6 py-3 text-slate-600 dark:text-slate-300 max-w-[220px] truncate">
                      {row.recipient}
                    </td>
                    <td className="px-6 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <li className="flex items-start gap-2.5">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
      ) : (
        <XCircle className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />
      )}
      <div>
        <p
          className={cn(
            "text-sm",
            ok ? "text-slate-700 dark:text-slate-200" : "text-slate-400",
          )}
        >
          {label}
        </p>
        {detail && !ok ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {detail}
          </p>
        ) : null}
      </div>
    </li>
  );
}

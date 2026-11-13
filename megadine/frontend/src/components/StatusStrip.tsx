import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "../lib/api";
import { failedCount, pendingCount } from "../lib/outbox";
import { useAuth } from "../store/auth";

interface HardwareStatus {
  printerMode: string;
  receiptPrinter: string;
  kitchenPrinter: string;
  simulateMode: boolean;
}

interface BackupStatus {
  last: { createdAt: string; status: string } | null;
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Persistent health strip for the operational screens (POS, floor, KDS).
 * Shows network state, printer configuration, the offline outbox queues and,
 * for users allowed to manage backups, how old the last backup is.
 */
export default function StatusStrip() {
  const { t } = useTranslation(["ops", "common"]);
  const { can } = useAuth();
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [queued, setQueued] = useState(() => pendingCount());
  const [failed, setFailed] = useState(() => failedCount());

  useEffect(() => {
    const sync = () => {
      setQueued(pendingCount());
      setFailed(failedCount());
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("md:outbox", sync);
    const timer = setInterval(sync, 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("md:outbox", sync);
      clearInterval(timer);
    };
  }, []);

  const hardware = useQuery({
    queryKey: ["hardware-status"],
    queryFn: () => apiGet<HardwareStatus>("/admin/hardware/status"),
    refetchInterval: 60000,
    staleTime: 30000,
    retry: 0,
  });

  const backup = useQuery({
    queryKey: ["backup-status", "strip"],
    queryFn: () => apiGet<BackupStatus>("/admin/backup/status"),
    enabled: can("backup.manage"),
    refetchInterval: 120000,
    staleTime: 60000,
    retry: 0,
  });

  const printer = hardware.data;
  const printerText = !printer
    ? t("ops:status_printer_unknown", { defaultValue: "Printer status unknown" })
    : printer.simulateMode
      ? t("ops:status_printer_simulated", { defaultValue: "Printer: simulated" })
      : `${t("ops:status_printer", { defaultValue: "Printer" })}: ${printer.receiptPrinter}`;

  const lastBackup = backup.data?.last ?? null;
  const backupAge = lastBackup ? timeAgo(lastBackup.createdAt) : null;
  const backupTone = !lastBackup ? "danger" : (Date.now() - new Date(lastBackup.createdAt).getTime()) > 24 * 3600 * 1000 ? "warn" : "ok";

  return (
    <div className={`status-strip ${online ? "" : "status-strip-offline"}`} role="status" aria-live="polite">
      <span className={`status-pill ${online ? "ok" : "danger"}`}>
        <span className="status-dot" />
        {online ? t("ops:status_online", { defaultValue: "Online" }) : t("ops:status_offline", { defaultValue: "Offline — working from cache" })}
      </span>
      <span className={`status-pill ${printer ? (printer.simulateMode ? "warn" : "ok") : "warn"}`}>
        {printerText}
      </span>
      {queued > 0 && (
        <span className="status-pill warn">
          {t("ops:status_queued", { count: queued, defaultValue: "{{count}} queued" })}
        </span>
      )}
      {failed > 0 && (
        <span className="status-pill danger">
          {t("ops:status_failed", { count: failed, defaultValue: "{{count}} failed to send" })}
        </span>
      )}
      {can("backup.manage") && (
        <span className={`status-pill ${backupTone}`}>
          {lastBackup
            ? t("ops:status_backup_age", { age: backupAge, defaultValue: "Backup {{age}} ago" })
            : t("ops:status_no_backup", { defaultValue: "No backup yet" })}
        </span>
      )}
      <span className="spacer" />
      {!online && (
        <span className="status-pill warn">
          {t("ops:status_offline_hint", { defaultValue: "Orders will queue and send automatically" })}
        </span>
      )}
    </div>
  );
}

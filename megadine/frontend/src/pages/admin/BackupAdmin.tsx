import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../../lib/api";
import { useToast } from "../../components/ui";

interface BackupRun { id: string; kind: string; status: string; file: string | null; sizeBytes: number | null; createdAt: string; note: string | null }
interface BackupStatus { dir: string; files: number; last: BackupRun | null; count: number; runs: BackupRun[] }
interface BackupFile { name: string; size: number; modifiedAt: string }

export default function BackupAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common"]);
  const { data } = useQuery({ queryKey: ["backup"], queryFn: () => apiGet<BackupStatus>("/admin/backup/status") });
  const { data: files } = useQuery({ queryKey: ["backup-files"], queryFn: () => apiGet<{ files: BackupFile[] }>("/admin/backup/files") });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["backup"] });
    qc.invalidateQueries({ queryKey: ["backup-files"] });
  };

  const run = useMutation({
    mutationFn: (kind: string) => apiPost(`/admin/backup/run?kind=${kind}`),
    onSuccess: () => { invalidate(); push(t("admin:bkp_started"), "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
  });

  const exportUsb = useMutation({
    mutationFn: () => apiPost("/admin/backup/export"),
    onSuccess: () => { invalidate(); push(t("admin:bkp_exported"), "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
  });

  const restore = useMutation({
    mutationFn: (file: string) => apiPost("/admin/backup/restore", { file, confirm: true }),
    onSuccess: () => { invalidate(); push(t("admin:bkp_restored"), "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:bkp_restore_failed"), "error"),
  });

  return (
    <div>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="v">{data?.last ? new Date(data.last.createdAt).toLocaleDateString() : t("admin:bkp_never")}</div><div className="l">{t("admin:bkp_last")}</div></div>
        <div className="stat"><div className="v">{data?.count ?? 0}</div><div className="l">{t("admin:bkp_total_runs")}</div></div>
        <div className="stat"><div className="v small mono" style={{ fontSize: 14 }}>{data?.dir ?? "—"}</div><div className="l">{t("admin:bkp_directory")}</div></div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" disabled={run.isPending} onClick={() => run.mutate("MANUAL")}>{t("admin:bkp_run_now")}</button>
        <button className="btn" disabled={run.isPending} onClick={() => run.mutate("USB")}>{t("admin:bkp_to_usb")}</button>
        <button className="btn" disabled={exportUsb.isPending} onClick={() => exportUsb.mutate()}>{t("admin:bkp_export_usb")}</button>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>{t("admin:bkp_runs")}</h3>
          <table className="tbl">
            <thead><tr><th>{t("admin:inv_col_when")}</th><th>{t("admin:bkp_col_kind")}</th><th>{t("admin:col_status")}</th><th>{t("admin:bkp_col_size")}</th><th>{t("admin:bkp_col_file")}</th></tr></thead>
            <tbody>
              {(data?.runs ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="small muted">{new Date(b.createdAt).toLocaleString()}</td>
                  <td>{b.kind}</td>
                  <td>{b.status === "SUCCESS" ? <span className="badge ok">{t("admin:bkp_ok")}</span> : <span className="badge danger">{b.status}</span>}</td>
                  <td className="mono small">{b.sizeBytes ? `${Math.round(b.sizeBytes / 1024)} KB` : "—"}</td>
                  <td className="small muted">{b.file ?? b.note ?? "—"}</td>
                </tr>
              ))}
              {(data?.runs ?? []).length === 0 && <tr><td colSpan={5} className="muted">{t("admin:bkp_empty")}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>{t("admin:bkp_files")}</h3>
          <table className="tbl">
            <thead><tr><th>{t("admin:col_name")}</th><th>{t("admin:bkp_col_size")}</th><th /></tr></thead>
            <tbody>
              {(files?.files ?? []).map((f) => (
                <tr key={f.name}>
                  <td className="mono small">{f.name}</td>
                  <td className="mono small">{Math.round(f.size / 1024)} KB</td>
                  <td>
                    {f.name.endsWith(".sql") && (
                      <button
                        className="btn ghost small"
                        disabled={restore.isPending}
                        onClick={() => { if (confirm(t("admin:bkp_restore_confirm", { file: f.name }))) restore.mutate(f.name); }}
                      >
                        {t("admin:bkp_restore")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(files?.files ?? []).length === 0 && <tr><td colSpan={3} className="muted">{t("admin:bkp_no_files")}</td></tr>}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 8 }}>{t("admin:bkp_sql_hint")}</p>
        </div>
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import { useToast } from "../../components/ui";

interface BackupRun { id: string; kind: string; status: string; file: string | null; sizeBytes: number | null; createdAt: string; note: string | null }
interface BackupStatus { dir: string; files: number; last: BackupRun | null; count: number; runs: BackupRun[] }
interface BackupFile { name: string; size: number; modifiedAt: string }

export default function BackupAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data } = useQuery({ queryKey: ["backup"], queryFn: () => apiGet<BackupStatus>("/admin/backup/status") });
  const { data: files } = useQuery({ queryKey: ["backup-files"], queryFn: () => apiGet<{ files: BackupFile[] }>("/admin/backup/files") });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["backup"] });
    qc.invalidateQueries({ queryKey: ["backup-files"] });
  };

  const run = useMutation({
    mutationFn: (kind: string) => apiPost(`/admin/backup/run?kind=${kind}`),
    onSuccess: () => { invalidate(); push("Backup started", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const exportUsb = useMutation({
    mutationFn: () => apiPost("/admin/backup/export"),
    onSuccess: () => { invalidate(); push("Exported to USB", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const restore = useMutation({
    mutationFn: (file: string) => apiPost("/admin/backup/restore", { file, confirm: true }),
    onSuccess: () => { invalidate(); push("Database restored", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Restore failed", "error"),
  });

  return (
    <div>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="v">{data?.last ? new Date(data.last.createdAt).toLocaleDateString() : "Never"}</div><div className="l">Last backup</div></div>
        <div className="stat"><div className="v">{data?.count ?? 0}</div><div className="l">Total runs</div></div>
        <div className="stat"><div className="v small mono" style={{ fontSize: 14 }}>{data?.dir ?? "—"}</div><div className="l">Directory</div></div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" disabled={run.isPending} onClick={() => run.mutate("MANUAL")}>Run backup now</button>
        <button className="btn" disabled={run.isPending} onClick={() => run.mutate("USB")}>Backup to USB</button>
        <button className="btn" disabled={exportUsb.isPending} onClick={() => exportUsb.mutate()}>Export latest to USB drive</button>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Backup runs</h3>
          <table className="tbl">
            <thead><tr><th>When</th><th>Kind</th><th>Status</th><th>Size</th><th>File</th></tr></thead>
            <tbody>
              {(data?.runs ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="small muted">{new Date(b.createdAt).toLocaleString()}</td>
                  <td>{b.kind}</td>
                  <td>{b.status === "SUCCESS" ? <span className="badge ok">ok</span> : <span className="badge danger">{b.status}</span>}</td>
                  <td className="mono small">{b.sizeBytes ? `${Math.round(b.sizeBytes / 1024)} KB` : "—"}</td>
                  <td className="small muted">{b.file ?? b.note ?? "—"}</td>
                </tr>
              ))}
              {(data?.runs ?? []).length === 0 && <tr><td colSpan={5} className="muted">No backups yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Files on disk</h3>
          <table className="tbl">
            <thead><tr><th>Name</th><th>Size</th><th /></tr></thead>
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
                        onClick={() => { if (confirm(`Restore database from ${f.name}? This overwrites current data.`)) restore.mutate(f.name); }}
                      >
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(files?.files ?? []).length === 0 && <tr><td colSpan={3} className="muted">No backup files.</td></tr>}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 8 }}>Only <code>.sql</code> pg_dump files can be restored automatically.</p>
        </div>
      </div>
    </div>
  );
}

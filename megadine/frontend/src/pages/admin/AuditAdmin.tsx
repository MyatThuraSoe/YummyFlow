import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";

interface AuditLog { id: string; action: string; entityType: string | null; entityId: string | null; reason: string | null; createdAt: string; user: { name: string; role: string } | null }

export default function AuditAdmin() {
  const [action, setAction] = useState("");
  const { data } = useQuery({ queryKey: ["audit", action], queryFn: () => apiGet<{ logs: AuditLog[] }>("/admin/audit", { action: action || undefined, limit: 200 }) });

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Filter by action (e.g. AUTH_LOGIN)" value={action} onChange={(e) => setAction(e.target.value)} />
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Reason</th></tr></thead>
          <tbody>
            {(data?.logs ?? []).map((l) => (
              <tr key={l.id}>
                <td className="small muted">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="small">{l.user ? `${l.user.name} (${l.user.role})` : "system"}</td>
                <td><span className="badge muted">{l.action}</span></td>
                <td className="small muted">{l.entityType ?? "—"}</td>
                <td className="small muted">{l.reason ?? "—"}</td>
              </tr>
            ))}
            {(data?.logs ?? []).length === 0 && <tr><td colSpan={5} className="muted">No audit entries.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

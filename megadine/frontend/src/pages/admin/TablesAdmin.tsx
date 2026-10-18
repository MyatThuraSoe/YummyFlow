import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "../../lib/api";
import { Field, Modal, useToast } from "../../components/ui";

interface TableRow { id: string; number: number; name: string | null; capacity: number; zone: string; status: string; isActive: boolean; version: number }

export default function TablesAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data } = useQuery({ queryKey: ["tables"], queryFn: () => apiGet<{ tables: TableRow[] }>("/tables") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ number: "", name: "", capacity: "4", zone: "Main" });
  const [edit, setEdit] = useState<{ id: string; version: number; number: string; name: string; capacity: string; zone: string; status: string; statusEditable: boolean } | null>(null);

  const create = useMutation({
    mutationFn: () => apiPost("/tables", { number: Number(form.number), name: form.name || null, capacity: Number(form.capacity), zone: form.zone }),
    onSuccess: () => { setOpen(false); setForm({ number: "", name: "", capacity: "4", zone: "Main" }); qc.invalidateQueries({ queryKey: ["tables"] }); push("Table added", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const save = useMutation({
    mutationFn: () =>
      apiPatch(`/tables/${edit!.id}`, {
        number: Number(edit!.number),
        name: edit!.name || null,
        capacity: Number(edit!.capacity),
        zone: edit!.zone,
        ...(edit!.statusEditable ? { status: edit!.status } : {}),
        version: edit!.version,
      }),
    onSuccess: () => { setEdit(null); qc.invalidateQueries({ queryKey: ["tables"] }); push("Table updated", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setOpen(true)}>+ Table</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr><th>#</th><th>Name</th><th>Zone</th><th>Seats</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {(data?.tables ?? []).map((t) => (
              <tr key={t.id} style={t.isActive ? undefined : { opacity: 0.5 }}>
                <td><b>#{t.number}</b></td>
                <td>{t.name ?? "—"}</td>
                <td>{t.zone}</td>
                <td>{t.capacity}</td>
                <td>
                  {t.status}
                  {!t.isActive && <span className="badge muted" style={{ marginLeft: 6 }}>inactive</span>}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="btn small ghost"
                    onClick={() => setEdit({
                      id: t.id,
                      version: t.version,
                      number: String(t.number),
                      name: t.name ?? "",
                      capacity: String(t.capacity),
                      zone: t.zone,
                      status: t.status,
                      statusEditable: t.status === "AVAILABLE" || t.status === "OUT_OF_SERVICE",
                    })}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal
          title="New table"
          onClose={() => setOpen(false)}
          footer={<><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={!form.number} onClick={() => create.mutate()}>Add</button></>}
        >
          <Field label="Number"><input className="input" type="number" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></Field>
          <Field label="Name (optional)"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Capacity"><input className="input" type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
          <Field label="Zone"><input className="input" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} /></Field>
        </Modal>
      )}

      {edit && (
        <Modal
          title={`Edit table #${edit.number}`}
          onClose={() => setEdit(null)}
          footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={!edit.number || save.isPending} onClick={() => save.mutate()}>Save</button></>}
        >
          <Field label="Number"><input className="input" type="number" value={edit.number} onChange={(e) => setEdit({ ...edit, number: e.target.value })} /></Field>
          <Field label="Name (optional)"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Capacity"><input className="input" type="number" value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: e.target.value })} /></Field>
          <Field label="Zone"><input className="input" value={edit.zone} onChange={(e) => setEdit({ ...edit, zone: e.target.value })} /></Field>
          {edit.statusEditable ? (
            <Field label="Status">
              <select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                <option value="AVAILABLE">Available</option>
                <option value="OUT_OF_SERVICE">Out of service</option>
              </select>
            </Field>
          ) : (
            <p className="muted small">Status ({edit.status.replace(/_/g, " ")}) is managed by live operations.</p>
          )}
        </Modal>
      )}
    </div>
  );
}

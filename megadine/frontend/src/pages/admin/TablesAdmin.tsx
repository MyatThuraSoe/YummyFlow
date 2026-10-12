import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import { Field, Modal, useToast } from "../../components/ui";

interface TableRow { id: string; number: number; name: string | null; capacity: number; zone: string; status: string; isActive: boolean }

export default function TablesAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data } = useQuery({ queryKey: ["tables"], queryFn: () => apiGet<{ tables: TableRow[] }>("/tables") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ number: "", name: "", capacity: "4", zone: "Main" });

  const create = useMutation({
    mutationFn: () => apiPost("/tables", { number: Number(form.number), name: form.name || null, capacity: Number(form.capacity), zone: form.zone }),
    onSuccess: () => { setOpen(false); setForm({ number: "", name: "", capacity: "4", zone: "Main" }); qc.invalidateQueries({ queryKey: ["tables"] }); push("Table added", "ok"); },
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
            <tr><th>#</th><th>Name</th><th>Zone</th><th>Seats</th><th>Status</th></tr>
          </thead>
          <tbody>
            {(data?.tables ?? []).map((t) => (
              <tr key={t.id}>
                <td><b>#{t.number}</b></td>
                <td>{t.name ?? "—"}</td>
                <td>{t.zone}</td>
                <td>{t.capacity}</td>
                <td>{t.status}</td>
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
    </div>
  );
}

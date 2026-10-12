import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "../../lib/api";
import { Field, Modal, useToast } from "../../components/ui";

interface User { id: string; name: string; email: string | null; role: string; isActive: boolean; lastLoginAt: string | null }

const ROLES = ["OWNER", "ADMIN", "CASHIER", "WAITER", "KITCHEN"];

export default function StaffAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data } = useQuery({ queryKey: ["users"], queryFn: () => apiGet<{ users: User[] }>("/admin/users") });
  const [open, setOpen] = useState(false);
  const [pinFor, setPinFor] = useState<User | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "CASHIER", pin: "" });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  const create = useMutation({
    mutationFn: () => apiPost("/admin/users", { name: form.name, email: form.email || null, role: form.role, pin: form.pin || undefined }),
    onSuccess: () => { setOpen(false); setForm({ name: "", email: "", role: "CASHIER", pin: "" }); invalidate(); push("Staff added", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiPatch(`/admin/users/${id}`, { isActive }),
    onSuccess: invalidate,
  });

  const resetPin = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) => apiPost(`/admin/users/${id}/reset-pin`, { pin }),
    onSuccess: () => { setPinFor(null); push("PIN reset", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setOpen(true)}>+ Staff</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Last login</th><th /></tr>
          </thead>
          <tbody>
            {(data?.users ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="small muted">{u.email ?? "—"}</td>
                <td><span className="badge muted">{u.role}</span></td>
                <td>{u.isActive ? <span className="badge ok">yes</span> : <span className="badge danger">no</span>}</td>
                <td className="small muted">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</td>
                <td>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <button className="btn small" onClick={() => setPinFor(u)}>Reset PIN</button>
                    <button className="btn ghost small" onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.isActive })}>
                      {u.isActive ? "Disable" : "Enable"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal
          title="New staff"
          onClose={() => setOpen(false)}
          footer={<><button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary" disabled={!form.name} onClick={() => create.mutate()}>Add</button></>}
        >
          <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email (optional)"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="PIN (4-6 digits)"><input className="input" inputMode="numeric" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></Field>
        </Modal>
      )}

      {pinFor && <PinModal user={pinFor} onClose={() => setPinFor(null)} onSubmit={(pin) => resetPin.mutate({ id: pinFor.id, pin })} />}
    </div>
  );
}

function PinModal({ user, onClose, onSubmit }: { user: User; onClose: () => void; onSubmit: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  return (
    <Modal
      title={`Reset PIN · ${user.name}`}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={pin.length < 4} onClick={() => onSubmit(pin)}>Save</button></>}
    >
      <Field label="New PIN"><input className="input" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} /></Field>
    </Modal>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPatch, apiPost } from "../../lib/api";
import { Field, Modal, useToast } from "../../components/ui";

interface TableRow { id: string; number: number; name: string | null; capacity: number; zone: string; status: string; isActive: boolean; version: number }

export default function TablesAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common", "ops"]);

  const statusLabel = (s: string) => t(`ops:table_status_${s.toLowerCase()}`, { defaultValue: s.replace(/_/g, " ") });
  const { data } = useQuery({ queryKey: ["tables"], queryFn: () => apiGet<{ tables: TableRow[] }>("/tables") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ number: "", name: "", capacity: "4", zone: "Main" });
  const [edit, setEdit] = useState<{ id: string; version: number; number: string; name: string; capacity: string; zone: string; status: string; statusEditable: boolean } | null>(null);

  const create = useMutation({
    mutationFn: () => apiPost("/tables", { number: Number(form.number), name: form.name || null, capacity: Number(form.capacity), zone: form.zone }),
    onSuccess: () => { setOpen(false); setForm({ number: "", name: "", capacity: "4", zone: "Main" }); qc.invalidateQueries({ queryKey: ["tables"] }); push(t("admin:tba_added"), "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
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
    onSuccess: () => { setEdit(null); qc.invalidateQueries({ queryKey: ["tables"] }); push(t("admin:tba_updated"), "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : t("admin:tba_failed"), "error"),
  });

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setOpen(true)}>{t("admin:tba_add")}</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr><th>#</th><th>{t("admin:col_name")}</th><th>{t("admin:tba_col_zone")}</th><th>{t("admin:tba_col_seats")}</th><th>{t("admin:col_status")}</th><th /></tr>
          </thead>
          <tbody>
            {(data?.tables ?? []).map((tb) => (
              <tr key={tb.id} style={tb.isActive ? undefined : { opacity: 0.5 }}>
                <td><b>#{tb.number}</b></td>
                <td>{tb.name ?? "—"}</td>
                <td>{tb.zone}</td>
                <td>{tb.capacity}</td>
                <td>
                  {statusLabel(tb.status)}
                  {!tb.isActive && <span className="badge muted" style={{ marginLeft: 6 }}>{t("admin:tba_inactive")}</span>}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="btn small ghost"
                    onClick={() => setEdit({
                      id: tb.id,
                      version: tb.version,
                      number: String(tb.number),
                      name: tb.name ?? "",
                      capacity: String(tb.capacity),
                      zone: tb.zone,
                      status: tb.status,
                      statusEditable: tb.status === "AVAILABLE" || tb.status === "OUT_OF_SERVICE",
                    })}
                  >
                    {t("admin:tba_edit")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal
          title={t("admin:tba_new_title")}
          onClose={() => setOpen(false)}
          footer={<><button className="btn ghost" onClick={() => setOpen(false)}>{t("common:cancel")}</button><button className="btn primary" disabled={!form.number} onClick={() => create.mutate()}>{t("admin:tba_btn_add")}</button></>}
        >
          <Field label={t("admin:tba_fld_number")}><input className="input" type="number" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></Field>
          <Field label={t("admin:tba_fld_name_optional")}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t("admin:tba_fld_capacity")}><input className="input" type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
          <Field label={t("admin:tba_fld_zone")}><input className="input" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} /></Field>
        </Modal>
      )}

      {edit && (
        <Modal
          title={t("admin:tba_edit_title", { number: edit.number })}
          onClose={() => setEdit(null)}
          footer={<><button className="btn ghost" onClick={() => setEdit(null)}>{t("common:cancel")}</button><button className="btn primary" disabled={!edit.number || save.isPending} onClick={() => save.mutate()}>{t("admin:tba_btn_save")}</button></>}
        >
          <Field label={t("admin:tba_fld_number")}><input className="input" type="number" value={edit.number} onChange={(e) => setEdit({ ...edit, number: e.target.value })} /></Field>
          <Field label={t("admin:tba_fld_name_optional")}><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label={t("admin:tba_fld_capacity")}><input className="input" type="number" value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: e.target.value })} /></Field>
          <Field label={t("admin:tba_fld_zone")}><input className="input" value={edit.zone} onChange={(e) => setEdit({ ...edit, zone: e.target.value })} /></Field>
          {edit.statusEditable ? (
            <Field label={t("admin:col_status")}>
              <select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                <option value="AVAILABLE">{t("ops:table_status_available")}</option>
                <option value="OUT_OF_SERVICE">{t("ops:table_status_out_of_service")}</option>
              </select>
            </Field>
          ) : (
            <p className="muted small">{t("admin:tba_managed", { status: statusLabel(edit.status) })}</p>
          )}
        </Modal>
      )}
    </div>
  );
}

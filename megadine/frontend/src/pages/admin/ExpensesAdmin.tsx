import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiDel, apiGet, apiPost } from "../../lib/api";
import { formatMoney, toCents } from "../../lib/format";
import { Field, Modal, useToast } from "../../components/ui";

interface Expense { id: string; date: string; category: string; amount: string; payee: string | null; paymentMethod: string | null; receiptRef: string | null; notes: string | null }
interface Settings { restaurant: { currency: string } | null }

const today = () => new Date().toISOString().slice(0, 10);

export default function ExpensesAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["admin", "common"]);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const { data } = useQuery({ queryKey: ["expenses", from, to], queryFn: () => apiGet<{ expenses: Expense[]; total: number }>("/expenses", { from, to }) });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const currency = settings?.restaurant?.currency ?? "USD";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "Supplies", amount: "", payee: "", paymentMethod: "CASH", receiptRef: "", notes: "", fromDrawer: false });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["expenses"] });

  const create = useMutation({
    mutationFn: () => apiPost("/expenses", { category: form.category, amount: Number(form.amount), payee: form.payee || undefined, paymentMethod: form.paymentMethod, receiptRef: form.receiptRef || undefined, notes: form.notes || undefined, fromDrawer: form.fromDrawer }),
    onSuccess: () => { setOpen(false); setForm({ category: "Supplies", amount: "", payee: "", paymentMethod: "CASH", receiptRef: "", notes: "", fromDrawer: false }); invalidate(); push(t("admin:exp_recorded"), "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : t("common:error"), "error"),
  });

  const del = useMutation({ mutationFn: (id: string) => apiDel(`/expenses/${id}`), onSuccess: invalidate });

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <button className="btn primary" onClick={() => setOpen(true)}>{t("admin:exp_add")}</button>
        <Field label={t("admin:fld_from")}><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t("admin:fld_to")}><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="spacer" />
        <span className="badge muted">{t("admin:exp_total_range", { amount: formatMoney(data?.total ?? 0, currency) })}</span>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr><th>{t("admin:col_date")}</th><th>{t("admin:col_category")}</th><th>{t("admin:exp_payee")}</th><th>{t("admin:exp_method")}</th><th>{t("admin:exp_ref")}</th><th style={{ textAlign: "right" }}>{t("admin:col_amount")}</th><th /></tr>
          </thead>
          <tbody>
            {(data?.expenses ?? []).map((e) => (
              <tr key={e.id}>
                <td className="small muted">{new Date(e.date).toLocaleDateString()}</td>
                <td>{e.category}</td>
                <td className="small">{e.payee ?? "—"}</td>
                <td className="small muted">{e.paymentMethod ?? "—"}</td>
                <td className="small muted">{e.receiptRef ?? "—"}</td>
                <td className="mono" style={{ textAlign: "right" }}>{formatMoney(toCents(e.amount), currency)}</td>
                <td><button className="btn ghost small" onClick={() => del.mutate(e.id)}>{t("admin:exp_delete")}</button></td>
              </tr>
            ))}
            {(data?.expenses ?? []).length === 0 && <tr><td colSpan={7} className="muted">{t("admin:exp_empty")}</td></tr>}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal
          title={t("admin:exp_record")}
          onClose={() => setOpen(false)}
          footer={<><button className="btn ghost" onClick={() => setOpen(false)}>{t("common:cancel")}</button><button className="btn primary" disabled={!form.amount} onClick={() => create.mutate()}>{t("common:save")}</button></>}
        >
          <Field label={t("admin:col_category")}><input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
          <Field label={t("admin:exp_amount_currency", { currency })}><input className="input" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label={t("admin:exp_payee")}><input className="input" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} /></Field>
          <Field label={t("admin:exp_payment_method")}>
            <select className="input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
              <option>CASH</option><option>CARD</option><option>TRANSFER</option>
            </select>
          </Field>
          <Field label={t("admin:exp_notes")}><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <Field label={t("admin:exp_receipt_ref")}><input className="input" value={form.receiptRef} onChange={(e) => setForm({ ...form, receiptRef: e.target.value })} /></Field>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={form.fromDrawer} onChange={(e) => setForm({ ...form, fromDrawer: e.target.checked })} />
            {t("admin:exp_from_drawer")}
          </label>
        </Modal>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch } from "../../lib/api";
import { Field, useToast } from "../../components/ui";

interface Restaurant {
  name: string;
  currency: string;
  businessDayCutoff: string;
  taxRate: string;
  taxInclusive: boolean;
  serviceChargePct: string;
  receiptHeader: string | null;
  receiptFooter: string | null;
}

interface LicenseInfo {
  limits: { edition: string; maxTerminals: number; maxTables: number; maxMenuItems: number };
  features: string[];
  usage: { terminals: number; tables: number; menuItems: number };
}

export default function SettingsAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<{ restaurant: Restaurant }>("/admin/settings") });
  const { data: lic } = useQuery({ queryKey: ["license"], queryFn: () => apiGet<LicenseInfo>("/admin/license") });
  const [form, setForm] = useState({ name: "", currency: "USD", businessDayCutoff: "04:00", taxPct: "8.5", taxInclusive: false, servicePct: "0", receiptHeader: "", receiptFooter: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (data?.restaurant && !loaded) {
      const r = data.restaurant;
      setForm({
        name: r.name,
        currency: r.currency,
        businessDayCutoff: r.businessDayCutoff,
        taxPct: String((Number(r.taxRate) * 100).toFixed(2)),
        taxInclusive: r.taxInclusive,
        servicePct: String((Number(r.serviceChargePct) * 100).toFixed(2)),
        receiptHeader: r.receiptHeader ?? "",
        receiptFooter: r.receiptFooter ?? "",
      });
      setLoaded(true);
    }
  }, [data, loaded]);

  const save = useMutation({
    mutationFn: () =>
      apiPatch("/admin/settings", {
        name: form.name,
        currency: form.currency,
        businessDayCutoff: form.businessDayCutoff,
        taxRate: Number(form.taxPct) / 100,
        taxInclusive: form.taxInclusive,
        serviceChargePct: Number(form.servicePct) / 100,
        receiptHeader: form.receiptHeader || null,
        receiptFooter: form.receiptFooter || null,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); push("Settings saved", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  return (
    <>
    <div className="card" style={{ maxWidth: 560 }}>
      <h3>Restaurant settings</h3>
      <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <div className="row">
        <Field label="Currency"><input className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></Field>
        <Field label="Business day cutoff"><input className="input" value={form.businessDayCutoff} onChange={(e) => setForm({ ...form, businessDayCutoff: e.target.value })} /></Field>
      </div>
      <div className="row">
        <Field label="Tax rate (%)"><input className="input" type="number" value={form.taxPct} onChange={(e) => setForm({ ...form, taxPct: e.target.value })} /></Field>
        <Field label="Service charge (%)"><input className="input" type="number" value={form.servicePct} onChange={(e) => setForm({ ...form, servicePct: e.target.value })} /></Field>
      </div>
      <label className="row" style={{ marginBottom: 10 }}>
        <input type="checkbox" checked={form.taxInclusive} onChange={(e) => setForm({ ...form, taxInclusive: e.target.checked })} />
        <span>Prices include tax (tax-inclusive)</span>
      </label>
      <Field label="Receipt header"><input className="input" value={form.receiptHeader} onChange={(e) => setForm({ ...form, receiptHeader: e.target.value })} /></Field>
      <Field label="Receipt footer"><input className="input" value={form.receiptFooter} onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })} /></Field>
      <button className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save settings"}</button>
    </div>

    {lic && (
      <div className="card" style={{ maxWidth: 560, marginTop: 16 }}>
        <h3>Plan &amp; usage <span className="badge muted">{lic.limits.edition}</span></h3>
        <table className="table">
          <thead><tr><th>Resource</th><th>Used</th><th>Limit</th><th /></tr></thead>
          <tbody>
            <UsageRow label="Terminals" used={lic.usage.terminals} max={lic.limits.maxTerminals} />
            <UsageRow label="Tables" used={lic.usage.tables} max={lic.limits.maxTables} />
            <UsageRow label="Menu items" used={lic.usage.menuItems} max={lic.limits.maxMenuItems} />
          </tbody>
        </table>
        <p className="muted small">Set a license key on the server to raise these limits.</p>
      </div>
    )}
    </>
  );
}

function UsageRow({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max === Number.MAX_SAFE_INTEGER ? 0 : Math.min(100, Math.round((used / max) * 100));
  const atLimit = used >= max;
  return (
    <tr>
      <td>{label}</td>
      <td>{used}</td>
      <td>{max === Number.MAX_SAFE_INTEGER ? "∞" : max}</td>
      <td style={{ minWidth: 140 }}>
        <div style={{ height: 8, background: "var(--border, #334155)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: atLimit ? "#ef4444" : pct > 80 ? "#f59e0b" : "#22c55e" }} />
        </div>
      </td>
    </tr>
  );
}

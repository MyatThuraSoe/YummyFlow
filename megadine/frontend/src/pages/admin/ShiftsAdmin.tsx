import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { Field, Modal, useToast } from "../../components/ui";
import { useAuth } from "../../store/auth";

interface Shift { id: string; status: string; openingFloat: string; openedAt: string; closedAt: string | null; businessDate: string }
interface Summary {
  orderCount: number; openingFloat: number; cashSales: number; cashRefunds: number; paidIn: number; paidOut: number;
  safeDrops: number; expectedCash: number; byMethod: Record<string, number>; refundTotal: number; payments: number;
  totals: { gross: number; subtotal: number; tax: number; discounts: number; service: number };
}
interface Current { shift: Shift | null; summary?: Summary }
interface Settings { restaurant: { currency: string } | null }
interface ZReport {
  businessDate: string; grossSales: number; netSales: number; orderCount: number; cancelledOrders: number; refundTotal: number;
  voidedLines: number; byMethod: Record<string, number>; shiftCount: number; openShifts: number;
  cash: { openingFloat: number; cashSales: number; cashRefunds: number; paidIn: number; paidOut: number; safeDrops: number; expectedCash: number };
  expenses: { total: number }; closed: { id: string; variance: number } | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function ShiftsAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { can } = useAuth();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const currency = settings?.restaurant?.currency ?? "USD";
  const { data: current } = useQuery({ queryKey: ["shift"], queryFn: () => apiGet<Current>("/shifts/current") });
  const { data: shifts } = useQuery({ queryKey: ["shifts"], queryFn: () => apiGet<{ shifts: (Shift & { cashier: { name: string } })[] }>("/shifts") });
  const [report, setReport] = useState<ZReport | null>(null);
  const [date, setDate] = useState(today());
  const [movement, setMovement] = useState<{ type: string; amount: string } | null>(null);
  const [close, setClose] = useState<{ actualCash: string } | null>(null);
  const [closeDay, setCloseDay] = useState<{ actualCash: string } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shift"] });
    qc.invalidateQueries({ queryKey: ["shifts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const loadZ = useMutation({
    mutationFn: () => apiGet<{ report: ZReport }>("/reports/z-report", { date }),
    onSuccess: (r) => setReport(r.report),
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const doMovement = useMutation({
    mutationFn: () => apiPost(`/shifts/${current!.shift!.id}/movements`, { type: movement!.type, amount: Number(movement!.amount) }),
    onSuccess: () => { setMovement(null); invalidate(); push("Drawer updated", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const doClose = useMutation({
    mutationFn: () => apiPost(`/shifts/${current!.shift!.id}/close`, { actualCash: Number(close!.actualCash) }),
    onSuccess: () => { setClose(null); invalidate(); push("Shift closed", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const doCloseDay = useMutation({
    mutationFn: () => apiPost("/reports/z-report/close", { date, actualCash: Number(closeDay!.actualCash) }),
    onSuccess: () => { setCloseDay(null); loadZ.mutate(); push("Business day closed", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const openShift = useMutation({
    mutationFn: (openingFloat: number) => apiPost("/shifts/open", { openingFloat }),
    onSuccess: () => { invalidate(); push("Shift opened", "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });

  const s = current?.summary;

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <Field label="Business date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <button className="btn primary" onClick={() => loadZ.mutate()} disabled={loadZ.isPending}>{loadZ.isPending ? "…" : "Load Z-report (X)"}</button>
      </div>

      {!current?.shift && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>No open shift</h3>
          {can("shift.open") && (
            <button className="btn primary" onClick={() => { const v = prompt("Opening float", "0"); if (v !== null) openShift.mutate(Number(v)); }}>
              Open shift
            </button>
          )}
        </div>
      )}

      {current?.shift && s && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row">
            <h3 style={{ margin: 0, flex: 1 }}>Current shift · {current.shift.status}</h3>
            {can("shift.open") && <button className="btn small" onClick={() => setMovement({ type: "PAID_IN", amount: "" })}>Cash movement</button>}
            {can("shift.close") && <button className="btn small danger" onClick={() => setClose({ actualCash: (s.expectedCash / 100).toFixed(2) })}>Close shift</button>}
          </div>
          <div className="grid cols-3" style={{ marginTop: 12 }}>
            <div className="stat"><div className="v">{formatMoney(s.expectedCash, currency)}</div><div className="l">Expected cash</div></div>
            <div className="stat"><div className="v">{formatMoney(s.cashSales, currency)}</div><div className="l">Cash sales</div></div>
            <div className="stat"><div className="v">{s.orderCount}</div><div className="l">Orders</div></div>
            <div className="stat"><div className="v">{formatMoney(s.totals.gross, currency)}</div><div className="l">Gross sales</div></div>
            <div className="stat"><div className="v">{formatMoney(s.totals.tax, currency)}</div><div className="l">Tax</div></div>
            <div className="stat"><div className="v">{formatMoney(s.totals.discounts, currency)}</div><div className="l">Discounts</div></div>
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            {Object.entries(s.byMethod).map(([m, v]) => (
              <span key={m} className="badge muted">{m}: {formatMoney(v, currency)}</span>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Float {formatMoney(s.openingFloat, currency)} · Paid in {formatMoney(s.paidIn, currency)} · Paid out {formatMoney(s.paidOut, currency)} · Safe drops {formatMoney(s.safeDrops, currency)} · Refunds {formatMoney(s.refundTotal, currency)}
          </p>
        </div>
      )}

      {report && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row">
            <h3 style={{ margin: 0, flex: 1 }}>Z-report · {new Date(report.businessDate).toLocaleDateString()}</h3>
            {report.closed ? <span className="badge ok">Day closed</span> : can("report.z") && (
              <button className="btn small danger" onClick={() => setCloseDay({ actualCash: (report.cash.expectedCash / 100).toFixed(2) })}>Close business day</button>
            )}
          </div>
          <div className="grid cols-3" style={{ marginTop: 12 }}>
            <div className="stat"><div className="v">{formatMoney(report.grossSales, currency)}</div><div className="l">Gross sales</div></div>
            <div className="stat"><div className="v">{formatMoney(report.netSales, currency)}</div><div className="l">Net sales</div></div>
            <div className="stat"><div className="v">{formatMoney(report.cash.expectedCash, currency)}</div><div className="l">Expected cash</div></div>
            <div className="stat"><div className="v">{report.orderCount}</div><div className="l">Orders</div></div>
            <div className="stat"><div className="v">{report.cancelledOrders}</div><div className="l">Cancelled</div></div>
            <div className="stat"><div className="v">{report.voidedLines}</div><div className="l">Voided lines</div></div>
            <div className="stat"><div className="v">{formatMoney(report.expenses.total, currency)}</div><div className="l">Expenses</div></div>
            <div className="stat"><div className="v">{report.shiftCount} ({report.openShifts} open)</div><div className="l">Shifts</div></div>
            <div className="stat"><div className="v">{formatMoney(report.refundTotal, currency)}</div><div className="l">Refunds</div></div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Shift history</h3>
        <table className="tbl">
          <thead><tr><th>Opened</th><th>Cashier</th><th>Status</th><th style={{ textAlign: "right" }}>Float</th><th style={{ textAlign: "right" }}>Closed</th></tr></thead>
          <tbody>
            {(shifts?.shifts ?? []).map((sh) => (
              <tr key={sh.id}>
                <td className="small muted">{new Date(sh.openedAt).toLocaleString()}</td>
                <td>{sh.cashier?.name}</td>
                <td>{sh.status === "OPEN" ? <span className="badge ok">open</span> : <span className="badge muted">closed</span>}</td>
                <td className="mono" style={{ textAlign: "right" }}>{formatMoney(Math.round(Number(sh.openingFloat) * 100), currency)}</td>
                <td className="small muted" style={{ textAlign: "right" }}>{sh.closedAt ? new Date(sh.closedAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {(shifts?.shifts ?? []).length === 0 && <tr><td colSpan={5} className="muted">No shifts yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {movement && (
        <Modal title="Cash movement" onClose={() => setMovement(null)} footer={<><button className="btn ghost" onClick={() => setMovement(null)}>Cancel</button><button className="btn primary" disabled={!movement.amount} onClick={() => doMovement.mutate()}>Apply</button></>}>
          <Field label="Type">
            <select className="input" value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value })}>
              <option value="PAID_IN">Paid in</option>
              <option value="PAID_OUT">Paid out</option>
              <option value="SAFE_DROP">Safe drop</option>
            </select>
          </Field>
          <Field label={`Amount (${currency})`}><input className="input" type="number" value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: e.target.value })} /></Field>
        </Modal>
      )}

      {close && current?.summary && (
        <Modal title="Close shift" onClose={() => setClose(null)} footer={<><button className="btn ghost" onClick={() => setClose(null)}>Cancel</button><button className="btn primary" disabled={!close.actualCash} onClick={() => doClose.mutate()}>Close</button></>}>
          <p className="muted small">Expected {formatMoney(current.summary.expectedCash, currency)}</p>
          <Field label={`Counted cash (${currency})`}><input className="input" type="number" value={close.actualCash} onChange={(e) => setClose({ actualCash: e.target.value })} /></Field>
          <p className="small">Variance: {formatMoney(Math.round((Number(close.actualCash) * 100) - current.summary.expectedCash), currency)}</p>
        </Modal>
      )}

      {closeDay && report && (
        <Modal title="Close business day" onClose={() => setCloseDay(null)} footer={<><button className="btn ghost" onClick={() => setCloseDay(null)}>Cancel</button><button className="btn primary" disabled={!closeDay.actualCash} onClick={() => doCloseDay.mutate()}>Close day</button></>}>
          <p className="muted small">Expected {formatMoney(report.cash.expectedCash, currency)}</p>
          <Field label={`Counted cash (${currency})`}><input className="input" type="number" value={closeDay.actualCash} onChange={(e) => setCloseDay({ actualCash: e.target.value })} /></Field>
          <p className="small">Variance: {formatMoney(Math.round((Number(closeDay.actualCash) * 100) - report.cash.expectedCash), currency)}</p>
        </Modal>
      )}
    </div>
  );
}

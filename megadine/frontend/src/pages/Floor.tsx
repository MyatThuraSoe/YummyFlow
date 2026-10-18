import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../lib/api";
import { formatMoney, fromCents, toCents } from "../lib/format";
import { printOrderReceipt } from "../lib/receipts";
import { Badge, Field, Modal, useToast } from "../components/ui";
import { useCart } from "../store/cart";
import { useNavigate } from "react-router-dom";

interface TableCurrent { sessionId: string; orderId: string | null; orderNumber: number | null; total: string; itemCount: number; status: string | null }
interface TableRow { id: string; number: number; name: string | null; capacity: number; zone: string; status: string; version: number; current: TableCurrent | null }
interface OrderLine { id: string; itemNameSnapshot: string; quantity: number; lineTotal: string; isVoided: boolean }
interface OrderShape { id: string; orderNumber: number; status: string; total: string; lines: OrderLine[]; tableSession?: { table: { number: number } } | null }
interface Settings { restaurant: { currency: string } | null }

const STATUSES = ["AVAILABLE", "OCCUPIED", "NEEDS_BILL", "NEEDS_CLEANING", "RESERVED", "OUT_OF_SERVICE"];

export default function Floor() {
  const qc = useQueryClient();
  const { push } = useToast();
  const nav = useNavigate();
  const cart = useCart();
  const { data } = useQuery({ queryKey: ["tables"], queryFn: () => apiGet<{ tables: TableRow[] }>("/tables"), refetchInterval: 15000 });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const currency = settings?.restaurant?.currency ?? "USD";
  const [selected, setSelected] = useState<TableRow | null>(null);
  const [bill, setBill] = useState<string | null>(null);

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPost(`/tables/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
    onError: (e) => push(e instanceof Error ? e.message : "Failed", "error"),
  });
  const clearMut = useMutation({
    mutationFn: (id: string) => apiPost(`/tables/${id}/clear`),
    onSuccess: () => {
      push("Table cleared", "ok");
      qc.invalidateQueries({ queryKey: ["tables"] });
      setSelected(null);
    },
  });

  function startOrder(t: TableRow) {
    cart.reset();
    cart.setChannel("DINE_IN");
    cart.setTable(t.id, `#${t.number}`);
    setSelected(null);
    nav(t.status === "OCCUPIED" ? `/pos?tableId=${t.id}` : "/pos");
  }

  const tables = data?.tables ?? [];
  const selectedHasOpenOrder =
    !!selected?.current?.orderId && selected.current.status !== "COMPLETED" && selected.current.status !== "CANCELLED";

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {STATUSES.map((s) => (
          <Badge key={s} kind={statusKind(s)}>
            {s}
          </Badge>
        ))}
        <span className="muted small">· live · {tables.length} tables</span>
      </div>
      <div className="table-grid">
        {tables.map((t) => (
          <button key={t.id} className={`table-card ${t.status}`} onClick={() => setSelected(t)}>
            <div className="row">
              <span style={{ fontSize: 22, fontWeight: 800 }}>#{t.number}</span>
              <div className="spacer" />
              <Badge kind={statusKind(t.status)}>{t.status.replace("NEEDS_", "")}</Badge>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {t.zone} · seats {t.capacity}
              {t.name ? ` · ${t.name}` : ""}
            </div>
            {t.current && (
              <div style={{ marginTop: 10 }}>
                <div className="small">Order #{t.current.orderNumber}</div>
                <div className="mono big" style={{ fontSize: 18 }}>{formatMoney(toCents(t.current.total), currency)}</div>
                <div className="small muted">{t.current.itemCount} items</div>
              </div>
            )}
          </button>
        ))}
      </div>

      {selected && (
        <Modal
          title={`Table #${selected.number}`}
          onClose={() => setSelected(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setSelected(null)}>Close</button>
              {selected.current ? (
                <>
                  <button className="btn" onClick={() => setBill(selected.current!.orderId!)} disabled={!selected.current.orderId}>
                    View bill
                  </button>
                  <button className="btn danger" onClick={() => clearMut.mutate(selected.id)} disabled={selectedHasOpenOrder}>
                    Clear table
                  </button>
                </>
              ) : (
                <button className="btn primary" onClick={() => startOrder(selected)}>Start order</button>
              )}
            </>
          }
        >
          <p className="muted small">
            {selected.zone} · seats {selected.capacity} · status <b>{selected.status}</b>
          </p>
          {selected.current && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="row">
                <span>Order #{selected.current.orderNumber}</span>
                <div className="spacer" />
                <span className="mono">{formatMoney(toCents(selected.current.total), currency)}</span>
              </div>
            </div>
          )}
          {selectedHasOpenOrder && (
            <p className="badge warn" style={{ marginBottom: 12 }}>
              This table has an open order — pay or cancel it before clearing.
            </p>
          )}
          <Field label="Set status">
            <div className="row wrap">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  className={`cat-tab ${selected.status === s ? "active" : ""}`}
                  onClick={() => {
                    statusMut.mutate({ id: selected.id, status: s });
                    setSelected({ ...selected, status: s });
                  }}
                >
                  {s.replace("NEEDS_", "")}
                </button>
              ))}
            </div>
          </Field>
          {selected.current?.orderId && (
            <button className="btn block" onClick={() => { setSelected(null); nav(`/pos?tableId=${selected.id}`); }}>
              Add items in POS
            </button>
          )}
        </Modal>
      )}

      {bill && <BillModal orderId={bill} currency={currency} onClose={() => setBill(null)} onPaid={() => { setBill(null); setSelected(null); qc.invalidateQueries({ queryKey: ["tables"] }); }} />}
    </div>
  );
}

function statusKind(s: string) {
  return s === "AVAILABLE" ? "ok" : s === "OCCUPIED" ? "warn" : s === "NEEDS_BILL" ? "info" : s === "OUT_OF_SERVICE" ? "muted" : "danger";
}

function BillModal({ orderId, currency, onClose, onPaid }: { orderId: string; currency: string; onClose: () => void; onPaid: () => void }) {
  const { push } = useToast();
  const { data } = useQuery({ queryKey: ["order", orderId], queryFn: () => apiGet<{ order: OrderShape }>(`/orders/${orderId}`) });
  const { data: shiftRes } = useQuery({ queryKey: ["shift"], queryFn: () => apiGet<{ shift: { id: string } | null }>("/shifts/current") });
  const [method, setMethod] = useState("CASH");
  const [cash, setCash] = useState("");
  const [reference, setReference] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [idemKey] = useState(() => `pay-${crypto.randomUUID()}`);
  const [paid, setPaid] = useState<{ orderNumber: number; preview: string; changeGiven: string | null } | null>(null);
  const order = data?.order;
  const total = order ? toCents(order.total) : 0;

  async function charge() {
    setBusy(true);
    setErr("");
    try {
      const res = await apiPost<{ order: { orderNumber: number; changeGiven: string | null; receiptPreview: string } }>("/payments", {
        orderId,
        shiftId: shiftRes?.shift?.id ?? null,
        idempotencyKey: idemKey,
        payments: [
          {
            method,
            amount: Number(fromCents(total)),
            cashReceived: method === "CASH" ? Number(cash || fromCents(total)) : undefined,
            reference: method !== "CASH" && reference ? reference : undefined,
          },
        ],
      });
      push("Payment complete", "ok");
      setPaid({ orderNumber: res.order.orderNumber, preview: res.order.receiptPreview, changeGiven: res.order.changeGiven });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  async function printReceipt() {
    try {
      const r = await printOrderReceipt(orderId);
      push(r.simulated ? "Receipt printed (simulated)" : "Receipt sent to printer", "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : "Print failed", "error");
    }
  }

  return (
    <Modal
      title={paid ? `Payment complete — order #${paid.orderNumber}` : order ? `Bill · Order #${order.orderNumber}` : "Bill"}
      onClose={paid ? onPaid : onClose}
      footer={
        paid ? (
          <>
            <button className="btn ghost" onClick={onPaid}>Done</button>
            <button className="btn primary" onClick={printReceipt}>Print receipt</button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose}>Close</button>
            <button className="btn primary" disabled={!order || busy} onClick={charge}>
              {busy ? "…" : `Charge ${formatMoney(total, currency)}`}
            </button>
          </>
        )
      }
    >
      {paid ? (
        <>
          {paid.changeGiven !== null && Number(paid.changeGiven) > 0 && (
            <div className="totals-row grand" style={{ marginTop: 0 }}>
              <span>Change due</span>
              <span className="mono">{formatMoney(toCents(paid.changeGiven), currency)}</span>
            </div>
          )}
          <pre className="receipt-paper">{paid.preview || "…"}</pre>
        </>
      ) : !order ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <table className="tbl">
            <thead>
              <tr><th>Item</th><th>Qty</th><th style={{ textAlign: "right" }}>Total</th></tr>
            </thead>
            <tbody>
              {order.lines.filter((l) => !l.isVoided).map((l) => (
                <tr key={l.id}>
                  <td>{l.itemNameSnapshot}</td>
                  <td>{l.quantity}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{formatMoney(toCents(l.lineTotal), currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="totals-row grand">
            <span>Total</span>
            <span className="mono">{formatMoney(total, currency)}</span>
          </div>
          {!shiftRes?.shift && <p className="badge warn" style={{ marginTop: 10 }}>No open shift — payment will not count toward a drawer</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="MOBILE">Mobile</option>
            </select>
            {method === "CASH" ? (
              <input className="input" type="number" placeholder="Cash received" value={cash} onChange={(e) => setCash(e.target.value)} />
            ) : (
              <input className="input" placeholder="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
            )}
          </div>
          {err && <p className="badge danger" style={{ marginTop: 10 }}>{err}</p>}
        </>
      )}
    </Modal>
  );
}

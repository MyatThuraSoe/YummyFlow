import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
interface Reservation {
  id: string;
  tableId: string;
  customerName: string;
  customerPhone: string | null;
  partySize: number;
  reservationTime: string;
  durationMinutes: number;
  status: string;
  notes: string | null;
}

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const STATUSES = ["AVAILABLE", "OCCUPIED", "NEEDS_BILL", "NEEDS_CLEANING", "RESERVED", "OUT_OF_SERVICE"];
const STATUS_KEYS: Record<string, string> = {
  AVAILABLE: "table_status_available",
  OCCUPIED: "table_status_occupied",
  NEEDS_BILL: "table_status_needs_bill",
  NEEDS_CLEANING: "table_status_needs_cleaning",
  RESERVED: "table_status_reserved",
  OUT_OF_SERVICE: "table_status_out_of_service",
};

export default function Floor() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["ops", "common"]);
  const nav = useNavigate();
  const cart = useCart();
  const { data } = useQuery({ queryKey: ["tables"], queryFn: () => apiGet<{ tables: TableRow[] }>("/tables"), refetchInterval: 15000 });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const { data: resData } = useQuery({
    queryKey: ["reservations", "today"],
    queryFn: () =>
      apiGet<{ reservations: Reservation[] }>("/reservations", {
        from: dayStart.toISOString(),
        to: dayEnd.toISOString(),
        status: "CONFIRMED",
      }),
    refetchInterval: 30000,
  });
  const currency = settings?.restaurant?.currency ?? "USD";
  const [selected, setSelected] = useState<TableRow | null>(null);
  const [bill, setBill] = useState<string | null>(null);
  const [resTarget, setResTarget] = useState<TableRow | null>(null);

  const reservations = resData?.reservations ?? [];
  const reservationsFor = (tableId: string) => reservations.filter((r) => r.tableId === tableId);

  const statusLabel = (s: string) => (STATUS_KEYS[s] ? t(`ops:${STATUS_KEYS[s]}`) : s);

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiPost(`/tables/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tables"] }),
    onError: (e) => push(e instanceof Error ? e.message : t("ops:failed"), "error"),
  });
  const clearMut = useMutation({
    mutationFn: (id: string) => apiPost(`/tables/${id}/clear`),
    onSuccess: () => {
      push(t("ops:floor_cleared"), "ok");
      qc.invalidateQueries({ queryKey: ["tables"] });
      setSelected(null);
    },
  });
  const reservationMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "seat" | "no-show" | "cancel" }) =>
      apiPost(`/reservations/${id}/${action}`),
    onSuccess: (_res, vars) => {
      const key = vars.action === "seat" ? "ops:floor_res_seated" : vars.action === "no-show" ? "ops:floor_res_no_show_done" : "ops:floor_res_cancelled";
      push(t(key), "ok");
      qc.invalidateQueries({ queryKey: ["reservations"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
    },
    onError: (e) => push(e instanceof Error ? e.message : t("ops:failed"), "error"),
  });
  const servedMut = useMutation({
    mutationFn: (orderId: string) => apiPost(`/orders/${orderId}/mark-served`),
    onSuccess: () => {
      push(t("ops:floor_marked_served"), "ok");
      qc.invalidateQueries({ queryKey: ["tables"] });
      setSelected(null);
    },
    onError: (e) => push(e instanceof Error ? e.message : t("ops:failed"), "error"),
  });

  function startOrder(tbl: TableRow) {
    cart.reset();
    cart.setChannel("DINE_IN");
    cart.setTable(tbl.id, `#${tbl.number}`);
    setSelected(null);
    nav(tbl.status === "OCCUPIED" ? `/pos?tableId=${tbl.id}` : "/pos");
  }

  const tables = data?.tables ?? [];
  const selectedHasOpenOrder =
    !!selected?.current?.orderId && selected.current.status !== "COMPLETED" && selected.current.status !== "CANCELLED";

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {STATUSES.map((s) => (
          <Badge key={s} kind={statusKind(s)}>
            {statusLabel(s)}
          </Badge>
        ))}
        <span className="muted small">{t("ops:floor_live_tables", { count: tables.length })}</span>
      </div>
      <div className="table-grid">
        {tables.map((tbl) => (
          <button key={tbl.id} className={`table-card ${tbl.status}`} onClick={() => setSelected(tbl)}>
            <div className="row">
              <span style={{ fontSize: 22, fontWeight: 800 }}>#{tbl.number}</span>
              <div className="spacer" />
              <Badge kind={statusKind(tbl.status)}>{statusLabel(tbl.status)}</Badge>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {t("ops:floor_seats", { zone: tbl.zone, capacity: tbl.capacity })}
              {tbl.name ? ` · ${tbl.name}` : ""}
            </div>
            {tbl.current && (
              <div style={{ marginTop: 10 }}>
                <div className="small">{t("ops:order_number", { number: tbl.current.orderNumber })}</div>
                <div className="mono big" style={{ fontSize: 18 }}>{formatMoney(toCents(tbl.current.total), currency)}</div>
                <div className="small muted">{t("ops:floor_items_count", { count: tbl.current.itemCount })}</div>
                {tbl.current.status === "READY" && (
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="badge warn">{t("ops:floor_ready_to_serve")}</span>
                  </div>
                )}
                {tbl.current.status === "SERVED" && (
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="badge ok">{t("ops:floor_served")}</span>
                  </div>
                )}
              </div>
            )}
            {reservationsFor(tbl.id)[0] && (
              <div className="reservation-badge">
                <span>{t("ops:floor_res_badge", { time: timeLabel(reservationsFor(tbl.id)[0].reservationTime), count: reservationsFor(tbl.id)[0].partySize })}</span>
              </div>
            )}
          </button>
        ))}
      </div>

      {selected && (
        <Modal
          title={t("ops:floor_table_title", { number: selected.number })}
          onClose={() => setSelected(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setSelected(null)}>{t("ops:close")}</button>
              <button className="btn" onClick={() => setResTarget(selected)}>{t("ops:floor_res_new")}</button>
              {selected.current?.status === "READY" && selected.current.orderId && (
                <button className="btn ok" onClick={() => servedMut.mutate(selected.current!.orderId!)}>
                  {t("ops:pos_mark_served")}
                </button>
              )}
              {selected.current ? (
                <>
                  <button className="btn" onClick={() => setBill(selected.current!.orderId!)} disabled={!selected.current.orderId}>
                    {t("ops:floor_view_bill")}
                  </button>
                  <button className="btn danger" onClick={() => clearMut.mutate(selected.id)} disabled={selectedHasOpenOrder}>
                    {t("ops:floor_clear")}
                  </button>
                </>
              ) : (
                <button className="btn primary" onClick={() => startOrder(selected)}>{t("ops:floor_start_order")}</button>
              )}
            </>
          }
        >
          <p className="muted small">
            {t("ops:floor_status_line", { zone: selected.zone, capacity: selected.capacity })} <b>{statusLabel(selected.status)}</b>
          </p>
          {selected.current && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="row">
                <span>{t("ops:order_number", { number: selected.current.orderNumber })}</span>
                <div className="spacer" />
                <span className="mono">{formatMoney(toCents(selected.current.total), currency)}</span>
              </div>
            </div>
          )}
          {selectedHasOpenOrder && (
            <p className="badge warn" style={{ marginBottom: 12 }}>
              {t("ops:floor_open_order_warning")}
            </p>
          )}
          {(() => {
            const soon = reservationsFor(selected.id).find(
              (r) => new Date(r.reservationTime).getTime() - Date.now() <= 30 * 60_000,
            );
            return soon ? (
              <p className="badge warn" style={{ marginBottom: 12 }}>
                {t("ops:floor_res_soon_warning", { time: timeLabel(soon.reservationTime) })}
              </p>
            ) : null;
          })()}
          {reservationsFor(selected.id).length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>{t("ops:floor_res_title")}</div>
              {reservationsFor(selected.id).map((r) => (
                <div className="row wrap" key={r.id} style={{ marginBottom: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div>
                      <b>{timeLabel(r.reservationTime)}</b> · {r.customerName} · {t("ops:floor_res_party_short", { count: r.partySize })}
                    </div>
                    {r.customerPhone && <div className="small muted">{r.customerPhone}</div>}
                  </div>
                  <button className="btn ok small" onClick={() => reservationMut.mutate({ id: r.id, action: "seat" })}>
                    {t("ops:floor_res_seat")}
                  </button>
                  <button className="btn ghost small" onClick={() => reservationMut.mutate({ id: r.id, action: "no-show" })}>
                    {t("ops:floor_res_no_show")}
                  </button>
                  <button className="btn ghost small" onClick={() => reservationMut.mutate({ id: r.id, action: "cancel" })}>
                    {t("ops:floor_res_cancel")}
                  </button>
                </div>
              ))}
            </div>
          )}
          <Field label={t("ops:floor_status_label")}>
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
                  {statusLabel(s)}
                </button>
              ))}
            </div>
          </Field>
          {selected.current?.orderId && (
            <button className="btn block" onClick={() => { setSelected(null); nav(`/pos?tableId=${selected.id}`); }}>
              {t("ops:floor_add_items")}
            </button>
          )}
        </Modal>
      )}

      {bill && <BillModal orderId={bill} currency={currency} onClose={() => setBill(null)} onPaid={() => { setBill(null); setSelected(null); qc.invalidateQueries({ queryKey: ["tables"] }); }} />}

      {resTarget && <NewReservationModal table={resTarget} onClose={() => setResTarget(null)} />}
    </div>
  );
}

function NewReservationModal({ table, onClose }: { table: TableRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { t } = useTranslation(["ops", "common"]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [duration, setDuration] = useState(90);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await apiPost("/reservations", {
        tableId: table.id,
        customerName: name,
        customerPhone: phone || null,
        partySize,
        reservationTime: new Date(time).toISOString(),
        durationMinutes: duration,
        notes: notes || null,
      });
      push(t("ops:floor_res_created"), "ok");
      qc.invalidateQueries({ queryKey: ["reservations"] });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ops:failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t("ops:floor_res_new_title", { number: table.number })}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>{t("ops:cancel")}</button>
          <button className="btn primary" disabled={busy || name.trim().length < 1} onClick={submit}>
            {busy ? "…" : t("ops:floor_res_save")}
          </button>
        </>
      }
    >
      <Field label={t("ops:floor_res_customer")}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label={t("ops:floor_res_phone")}>
        <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <div className="row">
        <Field label={t("ops:floor_res_party_label")}>
          <input
            className="input"
            type="number"
            min={1}
            max={50}
            value={partySize}
            onChange={(e) => setPartySize(Math.max(1, Number(e.target.value)))}
            style={{ width: 90 }}
          />
        </Field>
        <Field label={t("ops:floor_res_duration")}>
          <input
            className="input"
            type="number"
            min={15}
            max={480}
            step={15}
            value={duration}
            onChange={(e) => setDuration(Math.max(15, Number(e.target.value)))}
            style={{ width: 110 }}
          />
        </Field>
      </div>
      <Field label={t("ops:floor_res_time")}>
        <input className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
      </Field>
      <Field label={t("ops:floor_res_notes")}>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {err && <p className="badge danger">{err}</p>}
    </Modal>
  );
}

function statusKind(s: string) {
  return s === "AVAILABLE" ? "ok" : s === "OCCUPIED" ? "warn" : s === "NEEDS_BILL" ? "info" : s === "OUT_OF_SERVICE" ? "muted" : "danger";
}

function BillModal({ orderId, currency, onClose, onPaid }: { orderId: string; currency: string; onClose: () => void; onPaid: () => void }) {
  const { push } = useToast();
  const { t } = useTranslation(["ops", "common"]);
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
      push(t("ops:floor_payment_complete"), "ok");
      setPaid({ orderNumber: res.order.orderNumber, preview: res.order.receiptPreview, changeGiven: res.order.changeGiven });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("ops:floor_payment_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function printReceipt() {
    try {
      const r = await printOrderReceipt(orderId);
      push(r.simulated ? t("ops:receipt_printed_simulated") : t("ops:receipt_sent"), "ok");
    } catch (e) {
      push(e instanceof Error ? e.message : t("ops:print_failed"), "error");
    }
  }

  return (
    <Modal
      title={paid ? t("ops:floor_payment_complete_order", { number: paid.orderNumber }) : order ? t("ops:floor_bill_order", { number: order.orderNumber }) : t("ops:floor_bill")}
      onClose={paid ? onPaid : onClose}
      footer={
        paid ? (
          <>
            <button className="btn ghost" onClick={onPaid}>{t("ops:done")}</button>
            <button className="btn primary" onClick={printReceipt}>{t("ops:receipt_print")}</button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={onClose}>{t("ops:close")}</button>
            <button className="btn primary" disabled={!order || busy} onClick={charge}>
              {busy ? "…" : t("ops:pos_charge", { amount: formatMoney(total, currency) })}
            </button>
          </>
        )
      }
    >
      {paid ? (
        <>
          {paid.changeGiven !== null && Number(paid.changeGiven) > 0 && (
            <div className="totals-row grand" style={{ marginTop: 0 }}>
              <span>{t("ops:receipt_change_due")}</span>
              <span className="mono">{formatMoney(toCents(paid.changeGiven), currency)}</span>
            </div>
          )}
          <pre className="receipt-paper">{paid.preview || "…"}</pre>
        </>
      ) : !order ? (
        <p className="muted">{t("ops:loading")}</p>
      ) : (
        <>
          <table className="tbl">
            <thead>
              <tr><th>{t("ops:floor_item_header")}</th><th>{t("ops:floor_qty_header")}</th><th style={{ textAlign: "right" }}>{t("ops:floor_total_header")}</th></tr>
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
            <span>{t("ops:pos_total")}</span>
            <span className="mono">{formatMoney(total, currency)}</span>
          </div>
          {!shiftRes?.shift && <p className="badge warn" style={{ marginTop: 10 }}>{t("ops:floor_no_shift_warning")}</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">{t("ops:cash")}</option>
              <option value="CARD">{t("ops:card")}</option>
              <option value="MOBILE">{t("ops:mobile")}</option>
            </select>
            {method === "CASH" ? (
              <input className="input" type="number" placeholder={t("ops:pay_cash_received")} value={cash} onChange={(e) => setCash(e.target.value)} />
            ) : (
              <input className="input" placeholder={t("ops:pay_reference_placeholder")} value={reference} onChange={(e) => setReference(e.target.value)} />
            )}
          </div>
          {err && <p className="badge danger" style={{ marginTop: 10 }}>{err}</p>}
        </>
      )}
    </Modal>
  );
}

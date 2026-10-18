import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../../lib/api";
import { formatMoney, toCents } from "../../lib/format";
import { Field, Modal, useToast } from "../../components/ui";
import { useAuth } from "../../store/auth";

interface Shift {
  id: string; status: string; openingFloat: string; openedAt: string; closedAt: string | null; businessDate: string;
  expectedCash: string | null; actualCash: string | null; variance: string | null; closeNotes: string | null;
}
interface Summary {
  orderCount: number; openingFloat: number; cashSales: number; cashRefunds: number; paidIn: number; paidOut: number;
  safeDrops: number; expectedCash: number; byMethod: Record<string, number>; refundTotal: number; payments: number;
  varianceTolerance?: number; varianceExceedsTolerance?: boolean;
  totals: { gross: number; subtotal: number; tax: number; discounts: number; service: number };
}
interface Current { shift: Shift | null; summary?: Summary }
interface Settings { restaurant: { currency: string; cashVarianceTolerance?: string } | null }
interface ZReport {
  businessDate: string; grossSales: number; netSales: number; orderCount: number; cancelledOrders: number; refundTotal: number;
  voidedLines: number; byMethod: Record<string, number>; shiftCount: number; openShifts: number;
  cash: { openingFloat: number; cashSales: number; cashRefunds: number; paidIn: number; paidOut: number; safeDrops: number; expectedCash: number };
  expenses: { total: number }; closed: { id: string; variance: number } | null;
}
interface Movement { id: string; type: string; direction: string; amount: string; reason: string | null; createdAt: string }
interface DayClose { id: string; businessDate: string; closedAt: string; expectedCash: string; actualCash: string; variance: string; notes: string | null }

const today = () => new Date().toISOString().slice(0, 10);
const signed = (cents: number, currency: string) => `${cents > 0 ? "+" : ""}${formatMoney(cents, currency)}`;

export default function ShiftsAdmin() {
  const qc = useQueryClient();
  const { push } = useToast();
  const { can } = useAuth();
  const { t } = useTranslation(["admin", "cash", "common"]);
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const currency = settings?.restaurant?.currency ?? "USD";
  const tolCents = settings?.restaurant?.cashVarianceTolerance != null ? toCents(settings.restaurant.cashVarianceTolerance) : null;
  const { data: current } = useQuery({ queryKey: ["shift"], queryFn: () => apiGet<Current>("/shifts/current") });
  const { data: shifts } = useQuery({ queryKey: ["shifts"], queryFn: () => apiGet<{ shifts: (Shift & { cashier: { name: string } })[] }>("/shifts") });
  const { data: dayCloses } = useQuery({
    queryKey: ["day-closes"],
    queryFn: () => apiGet<{ closes: DayClose[] }>("/reports/day-closes"),
    enabled: can("report.z"),
  });
  const [report, setReport] = useState<ZReport | null>(null);
  const [date, setDate] = useState(today());
  const [openShiftModal, setOpenShiftModal] = useState<{ openingFloat: string } | null>(null);
  const [movement, setMovement] = useState<{ type: string; amount: string; reason: string } | null>(null);
  const [close, setClose] = useState<{ actualCash: string; notes: string } | null>(null);
  const [closeDay, setCloseDay] = useState<{ actualCash: string; notes: string } | null>(null);
  const [viewShift, setViewShift] = useState<Shift | null>(null);

  const xReport = useQuery({
    queryKey: ["x-report", viewShift?.id],
    queryFn: () => apiGet<{ report: Summary }>(`/shifts/${viewShift!.id}/x-report`),
    enabled: !!viewShift,
  });
  const movements = useQuery({
    queryKey: ["shift-movements", viewShift?.id],
    queryFn: () => apiGet<{ movements: Movement[] }>(`/shifts/${viewShift!.id}/movements`),
    enabled: !!viewShift,
    retry: 0,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shift"] });
    qc.invalidateQueries({ queryKey: ["shifts"] });
    qc.invalidateQueries({ queryKey: ["day-closes"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const loadZ = useMutation({
    mutationFn: () => apiGet<{ report: ZReport }>("/reports/z-report", { date }),
    onSuccess: (r) => setReport(r.report),
    onError: (e) => push(e instanceof Error ? e.message : t("common:error"), "error"),
  });

  const doMovement = useMutation({
    mutationFn: () => apiPost(`/shifts/${current!.shift!.id}/movements`, { type: movement!.type, amount: Number(movement!.amount), reason: movement!.reason || undefined }),
    onSuccess: () => { setMovement(null); invalidate(); push(t("admin:sh_drawer_updated"), "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : t("common:error"), "error"),
  });

  const doClose = useMutation({
    mutationFn: () => apiPost<{ variance: string; varianceTolerance: number; varianceExceedsTolerance: boolean }>(
      `/shifts/${current!.shift!.id}/close`,
      { actualCash: Number(close!.actualCash), notes: close!.notes || undefined },
    ),
    onSuccess: (r) => {
      setClose(null);
      invalidate();
      const v = signed(toCents(r.variance), currency);
      if (r.varianceExceedsTolerance) {
        push(t("admin:sh_shift_closed_exceeds", { amount: v, tolerance: formatMoney(toCents(String(r.varianceTolerance)), currency) }), "error");
      } else {
        push(t("admin:sh_shift_closed", { amount: v }), "ok");
      }
    },
    onError: (e) => push(e instanceof Error ? e.message : t("common:error"), "error"),
  });

  const doCloseDay = useMutation({
    mutationFn: () => apiPost<{ variance: string }>("/reports/z-report/close", {
      date: new Date(`${date}T12:00:00.000Z`).toISOString(),
      actualCash: Number(closeDay!.actualCash),
      notes: closeDay!.notes || undefined,
    }),
    onSuccess: (r) => {
      setCloseDay(null);
      loadZ.mutate();
      invalidate();
      push(t("admin:sh_day_closed_push", { amount: signed(toCents(r.variance), currency) }), "ok");
    },
    onError: (e) => push(e instanceof Error ? e.message : t("common:error"), "error"),
  });

  const openShift = useMutation({
    mutationFn: (openingFloat: number) => apiPost("/shifts/open", { openingFloat }),
    onSuccess: () => { setOpenShiftModal(null); invalidate(); push(t("admin:sh_shift_opened"), "ok"); },
    onError: (e) => push(e instanceof Error ? e.message : t("common:error"), "error"),
  });

  const s = current?.summary;
  const statusLabel = (status: string) => t(`admin:sh_status_${status.toLowerCase()}`, { defaultValue: status });

  function varianceBadge(v: string) {
    const cents = toCents(v);
    if (cents === 0) return <span className="badge muted">{signed(0, currency)}</span>;
    if (tolCents != null && Math.abs(cents) > tolCents) return <span className="badge danger">{signed(cents, currency)}</span>;
    return <span className="badge warn">{signed(cents, currency)}</span>;
  }

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <Field label={t("admin:sh_business_date")}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <button className="btn primary" onClick={() => loadZ.mutate()} disabled={loadZ.isPending}>{loadZ.isPending ? "…" : t("admin:sh_load_z")}</button>
      </div>

      {!current?.shift && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("admin:sh_no_open_shift")}</h3>
          {can("shift.open") && (
            <button className="btn primary" onClick={() => setOpenShiftModal({ openingFloat: "0" })}>
              {t("cash:open_shift")}
            </button>
          )}
        </div>
      )}

      {current?.shift && s && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row">
            <h3 style={{ margin: 0, flex: 1 }}>{t("admin:sh_current_shift")} · {statusLabel(current.shift.status)}</h3>
            {can("shift.open") && <button className="btn small" onClick={() => setMovement({ type: "PAID_IN", amount: "", reason: "" })}>{t("admin:sh_cash_movement")}</button>}
            {can("shift.close") && <button className="btn small danger" onClick={() => setClose({ actualCash: (s.expectedCash / 100).toFixed(2), notes: "" })}>{t("cash:close_shift")}</button>}
          </div>
          <div className="grid cols-3" style={{ marginTop: 12 }}>
            <div className="stat"><div className="v">{formatMoney(s.expectedCash, currency)}</div><div className="l">{t("admin:col_expected")}</div></div>
            <div className="stat"><div className="v">{formatMoney(s.cashSales, currency)}</div><div className="l">{t("admin:sh_cash_sales")}</div></div>
            <div className="stat"><div className="v">{s.orderCount}</div><div className="l">{t("admin:col_orders")}</div></div>
            <div className="stat"><div className="v">{formatMoney(s.totals.gross, currency)}</div><div className="l">{t("admin:dash_gross_sales")}</div></div>
            <div className="stat"><div className="v">{formatMoney(s.totals.tax, currency)}</div><div className="l">{t("admin:dash_tax")}</div></div>
            <div className="stat"><div className="v">{formatMoney(s.totals.discounts, currency)}</div><div className="l">{t("admin:dash_discounts")}</div></div>
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            {Object.entries(s.byMethod).map(([m, v]) => (
              <span key={m} className="badge muted">{m}: {formatMoney(v, currency)}</span>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            {t("admin:sh_float")} {formatMoney(s.openingFloat, currency)} · {t("admin:sh_paid_in")} {formatMoney(s.paidIn, currency)} · {t("admin:sh_paid_out")} {formatMoney(s.paidOut, currency)} · {t("admin:sh_safe_drops")} {formatMoney(s.safeDrops, currency)} · {t("admin:dash_refunds")} {formatMoney(s.refundTotal, currency)}
          </p>
        </div>
      )}

      {report && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row">
            <h3 style={{ margin: 0, flex: 1 }}>{t("admin:sh_z_report")} · {new Date(report.businessDate).toLocaleDateString()}</h3>
            {report.closed ? <span className="badge ok">{t("admin:sh_day_closed")}</span> : can("report.z") && (
              <button className="btn small danger" onClick={() => setCloseDay({ actualCash: (report.cash.expectedCash / 100).toFixed(2), notes: "" })}>{t("admin:sh_close_day")}</button>
            )}
          </div>
          <div className="grid cols-3" style={{ marginTop: 12 }}>
            <div className="stat"><div className="v">{formatMoney(report.grossSales, currency)}</div><div className="l">{t("admin:dash_gross_sales")}</div></div>
            <div className="stat"><div className="v">{formatMoney(report.netSales, currency)}</div><div className="l">{t("admin:dash_net_sales")}</div></div>
            <div className="stat"><div className="v">{formatMoney(report.cash.expectedCash, currency)}</div><div className="l">{t("admin:col_expected")}</div></div>
            <div className="stat"><div className="v">{report.orderCount}</div><div className="l">{t("admin:col_orders")}</div></div>
            <div className="stat"><div className="v">{report.cancelledOrders}</div><div className="l">{t("admin:col_cancelled")}</div></div>
            <div className="stat"><div className="v">{report.voidedLines}</div><div className="l">{t("admin:sh_voided_lines")}</div></div>
            <div className="stat"><div className="v">{formatMoney(report.expenses.total, currency)}</div><div className="l">{t("admin:sh_expenses")}</div></div>
            <div className="stat"><div className="v">{t("admin:sh_open_count", { count: report.shiftCount, open: report.openShifts })}</div><div className="l">{t("admin:sh_shifts")}</div></div>
            <div className="stat"><div className="v">{formatMoney(report.refundTotal, currency)}</div><div className="l">{t("admin:dash_refunds")}</div></div>
          </div>
          {report.closed && (
            <p className="small" style={{ marginTop: 10 }}>
              {t("admin:sh_day_closed_variance")}{" "}
              <span className={report.closed.variance === 0 ? "badge muted" : tolCents != null && Math.abs(report.closed.variance) > tolCents ? "badge danger" : "badge warn"}>
                {signed(report.closed.variance, currency)}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="card">
        <h3>{t("admin:sh_shift_history")}</h3>
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("admin:col_opened")}</th><th>{t("admin:col_cashier")}</th><th>{t("admin:col_status")}</th>
              <th style={{ textAlign: "right" }}>{t("admin:col_float")}</th>
              <th style={{ textAlign: "right" }}>{t("admin:col_expected")}</th>
              <th style={{ textAlign: "right" }}>{t("admin:col_actual")}</th>
              <th style={{ textAlign: "right" }}>{t("admin:col_variance")}</th>
              <th>{t("admin:col_closed")}</th><th />
            </tr>
          </thead>
          <tbody>
            {(shifts?.shifts ?? []).map((sh) => (
              <tr key={sh.id}>
                <td className="small muted">{new Date(sh.openedAt).toLocaleString()}</td>
                <td>{sh.cashier?.name}</td>
                <td>{sh.status === "OPEN" ? <span className="badge ok">{statusLabel(sh.status)}</span> : <span className="badge muted">{statusLabel(sh.status)}</span>}</td>
                <td className="mono" style={{ textAlign: "right" }}>{formatMoney(toCents(sh.openingFloat), currency)}</td>
                <td className="mono" style={{ textAlign: "right" }}>{sh.expectedCash != null ? formatMoney(toCents(sh.expectedCash), currency) : "—"}</td>
                <td className="mono" style={{ textAlign: "right" }}>{sh.actualCash != null ? formatMoney(toCents(sh.actualCash), currency) : "—"}</td>
                <td style={{ textAlign: "right" }}>{sh.variance != null ? varianceBadge(sh.variance) : <span className="muted">—</span>}</td>
                <td className="small muted">{sh.closedAt ? new Date(sh.closedAt).toLocaleString() : "—"}</td>
                <td style={{ textAlign: "right" }}>
                  {can("report.view") && <button className="btn small ghost" onClick={() => setViewShift(sh)}>{t("admin:sh_report")}</button>}
                </td>
              </tr>
            ))}
            {(shifts?.shifts ?? []).length === 0 && <tr><td colSpan={9} className="muted">{t("admin:sh_no_shifts")}</td></tr>}
          </tbody>
        </table>
      </div>

      {can("report.z") && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>{t("admin:sh_business_day_closes")}</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("admin:sh_business_date")}</th><th>{t("admin:col_closed_at")}</th>
                <th style={{ textAlign: "right" }}>{t("admin:col_expected")}</th>
                <th style={{ textAlign: "right" }}>{t("admin:col_actual")}</th>
                <th style={{ textAlign: "right" }}>{t("admin:col_variance")}</th>
                <th>{t("admin:col_notes")}</th>
              </tr>
            </thead>
            <tbody>
              {(dayCloses?.closes ?? []).map((c) => (
                <tr key={c.id}>
                  <td>{new Date(c.businessDate).toLocaleDateString()}</td>
                  <td className="small muted">{new Date(c.closedAt).toLocaleString()}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{formatMoney(toCents(c.expectedCash), currency)}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{formatMoney(toCents(c.actualCash), currency)}</td>
                  <td style={{ textAlign: "right" }}>{varianceBadge(c.variance)}</td>
                  <td className="small muted">{c.notes ?? "—"}</td>
                </tr>
              ))}
              {(dayCloses?.closes ?? []).length === 0 && <tr><td colSpan={6} className="muted">{t("admin:sh_no_day_closes")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {openShiftModal && (
        <Modal
          title={t("cash:open_shift")}
          onClose={() => setOpenShiftModal(null)}
          footer={<><button className="btn ghost" onClick={() => setOpenShiftModal(null)}>{t("common:cancel")}</button><button className="btn primary" disabled={openShiftModal.openingFloat === "" || Number(openShiftModal.openingFloat) < 0} onClick={() => openShift.mutate(Number(openShiftModal.openingFloat))}>{t("admin:sh_open_btn")}</button></>}
        >
          <Field label={t("admin:sh_opening_float_currency", { currency })}>
            <input className="input" type="number" value={openShiftModal.openingFloat} onChange={(e) => setOpenShiftModal({ openingFloat: e.target.value })} autoFocus />
          </Field>
        </Modal>
      )}

      {movement && (
        <Modal title={t("admin:sh_cash_movement")} onClose={() => setMovement(null)} footer={<><button className="btn ghost" onClick={() => setMovement(null)}>{t("common:cancel")}</button><button className="btn primary" disabled={!movement.amount || Number(movement.amount) <= 0} onClick={() => doMovement.mutate()}>{t("admin:sh_apply")}</button></>}>
          <Field label={t("admin:col_type")}>
            <select className="input" value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value })}>
              <option value="PAID_IN">{t("admin:mt_paid_in")}</option>
              <option value="PAID_OUT">{t("admin:mt_paid_out")}</option>
              <option value="SAFE_DROP">{t("admin:mt_safe_drop")}</option>
            </select>
          </Field>
          <Field label={t("admin:sh_amount_currency", { currency })}><input className="input" type="number" value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: e.target.value })} /></Field>
          <Field label={t("admin:sh_reason_optional")}><input className="input" value={movement.reason} onChange={(e) => setMovement({ ...movement, reason: e.target.value })} placeholder={t("admin:sh_reason_placeholder")} /></Field>
        </Modal>
      )}

      {close && current?.summary && (
        <Modal title={t("cash:close_shift")} onClose={() => setClose(null)} footer={<><button className="btn ghost" onClick={() => setClose(null)}>{t("common:cancel")}</button><button className="btn primary" disabled={!close.actualCash} onClick={() => doClose.mutate()}>{t("admin:sh_close_btn")}</button></>}>
          <p className="muted small">{t("admin:sh_expected_amount", { amount: formatMoney(current.summary.expectedCash, currency) })}</p>
          <Field label={t("admin:sh_counted_cash", { currency })}><input className="input" type="number" value={close.actualCash} onChange={(e) => setClose({ ...close, actualCash: e.target.value })} /></Field>
          {(() => {
            const varCents = Math.round(Number(close.actualCash || 0) * 100) - current.summary.expectedCash;
            const tol = toCents(String(current.summary.varianceTolerance ?? 0));
            const exceeds = Math.abs(varCents) > tol;
            return (
              <p className="small" style={{ marginTop: 8 }}>
                {t("admin:sh_variance_line", { amount: signed(varCents, currency) })}
                {exceeds && <span className="badge danger" style={{ marginLeft: 8 }}>{t("admin:sh_exceeds_tolerance", { amount: formatMoney(tol, currency) })}</span>}
              </p>
            );
          })()}
          <Field label={t("admin:sh_notes_optional")}><textarea className="input" rows={2} value={close.notes} onChange={(e) => setClose({ ...close, notes: e.target.value })} placeholder={t("admin:sh_notes_placeholder")} /></Field>
        </Modal>
      )}

      {closeDay && report && (
        <Modal title={t("admin:sh_close_day")} onClose={() => setCloseDay(null)} footer={<><button className="btn ghost" onClick={() => setCloseDay(null)}>{t("common:cancel")}</button><button className="btn primary" disabled={!closeDay.actualCash} onClick={() => doCloseDay.mutate()}>{t("admin:sh_close_day_btn")}</button></>}>
          <p className="muted small">{t("admin:sh_expected_amount", { amount: formatMoney(report.cash.expectedCash, currency) })}</p>
          <Field label={t("admin:sh_counted_cash", { currency })}><input className="input" type="number" value={closeDay.actualCash} onChange={(e) => setCloseDay({ ...closeDay, actualCash: e.target.value })} /></Field>
          <p className="small">{t("admin:sh_variance_line", { amount: signed(Math.round(Number(closeDay.actualCash || 0) * 100) - report.cash.expectedCash, currency) })}</p>
          <Field label={t("admin:sh_notes_optional")}><textarea className="input" rows={2} value={closeDay.notes} onChange={(e) => setCloseDay({ ...closeDay, notes: e.target.value })} /></Field>
        </Modal>
      )}

      {viewShift && (
        <Modal
          title={t("admin:sh_shift_report_title", { at: new Date(viewShift.openedAt).toLocaleString() })}
          onClose={() => setViewShift(null)}
          wide
          footer={<button className="btn ghost" onClick={() => setViewShift(null)}>{t("admin:sh_close_btn")}</button>}
        >
          {xReport.isLoading && <p className="muted">{t("common:loading")}</p>}
          {xReport.data?.report && (() => {
            const r = xReport.data.report;
            return (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span className="badge muted">{statusLabel(viewShift.status)}</span>
                  {viewShift.closedAt && <span className="badge muted">{t("admin:sh_closed_at_value", { value: new Date(viewShift.closedAt).toLocaleString() })}</span>}
                  {viewShift.variance != null && <>{t("admin:sh_variance_word")} {varianceBadge(viewShift.variance)}</>}
                  {viewShift.closeNotes && <span className="muted small">“{viewShift.closeNotes}”</span>}
                </div>
                <div className="grid cols-3">
                  <div className="stat"><div className="v">{formatMoney(r.expectedCash, currency)}</div><div className="l">{t("admin:col_expected")}</div></div>
                  <div className="stat"><div className="v">{formatMoney(r.cashSales, currency)}</div><div className="l">{t("admin:sh_cash_sales")}</div></div>
                  <div className="stat"><div className="v">{r.orderCount}</div><div className="l">{t("admin:col_orders")}</div></div>
                  <div className="stat"><div className="v">{formatMoney(r.totals.gross, currency)}</div><div className="l">{t("admin:dash_gross_sales")}</div></div>
                  <div className="stat"><div className="v">{formatMoney(r.totals.subtotal, currency)}</div><div className="l">{t("admin:col_subtotal")}</div></div>
                  <div className="stat"><div className="v">{formatMoney(r.totals.tax, currency)}</div><div className="l">{t("admin:dash_tax")}</div></div>
                  <div className="stat"><div className="v">{formatMoney(r.totals.discounts, currency)}</div><div className="l">{t("admin:dash_discounts")}</div></div>
                  <div className="stat"><div className="v">{formatMoney(r.totals.service, currency)}</div><div className="l">{t("admin:sh_service")}</div></div>
                  <div className="stat"><div className="v">{formatMoney(r.refundTotal, currency)}</div><div className="l">{t("admin:dash_refunds")}</div></div>
                </div>
                <p className="muted small" style={{ marginTop: 10 }}>
                  {t("admin:sh_float")} {formatMoney(r.openingFloat, currency)} · {t("admin:sh_paid_in")} {formatMoney(r.paidIn, currency)} · {t("admin:sh_paid_out")} {formatMoney(r.paidOut, currency)} · {t("admin:sh_safe_drops")} {formatMoney(r.safeDrops, currency)} · {t("admin:sh_payments_count", { count: r.payments })}
                </p>
                <div className="row wrap" style={{ marginTop: 8 }}>
                  {Object.entries(r.byMethod).map(([m, v]) => (
                    <span key={m} className="badge muted">{m}: {formatMoney(v, currency)}</span>
                  ))}
                </div>
                {(movements.data?.movements ?? []).length > 0 && (
                  <>
                    <h4 style={{ marginBottom: 6, marginTop: 16 }}>{t("admin:sh_cash_movements")}</h4>
                    <table className="tbl">
                      <thead><tr><th>{t("admin:col_time")}</th><th>{t("admin:col_type")}</th><th>{t("admin:col_reason")}</th><th style={{ textAlign: "right" }}>{t("admin:col_amount")}</th></tr></thead>
                      <tbody>
                        {movements.data!.movements.map((m) => (
                          <tr key={m.id}>
                            <td className="small muted">{new Date(m.createdAt).toLocaleString()}</td>
                            <td><span className="badge muted">{t(`admin:mt_${m.type.toLowerCase()}`, { defaultValue: m.type.replace(/_/g, " ") })}</span></td>
                            <td className="small">{m.reason ?? "—"}</td>
                            <td className="mono" style={{ textAlign: "right" }}>{signed(m.direction === "IN" ? toCents(m.amount) : -toCents(m.amount), currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            );
          })()}
          {xReport.isError && <p className="badge danger">{t("admin:sh_failed_report")}</p>}
        </Modal>
      )}
    </div>
  );
}

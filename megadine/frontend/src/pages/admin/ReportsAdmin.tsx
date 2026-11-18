import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { Field } from "../../components/ui";
import { useAuth } from "../../store/auth";

interface ItemRow { name: string; category: string; qty: number; revenue: number }
interface HourRow { hour: number; orders: number; sales: number }
interface EmpRow { id: string; name: string; role: string; orders: number; sales: number }
interface Settings { restaurant: { currency: string } | null }
interface FoodCost { netSales: number; usageCost: number; foodCostPercent: number }
interface WastageRow { ingredientName: string; quantity: number; unit: string; cost: number; reason: string | null; at: string }
interface Wastage { rows: WastageRow[]; totalCost: number }
interface StockRow { id: string; createdAt: string; type: string; quantity: string; reason: string | null; ingredient: { name: string; stockUnit: string } }
type ExceptionKind = "VOID" | "DISCOUNT" | "REFUND" | "CANCEL" | "CASH_VARIANCE" | "AFTER_HOURS_SIGNIN";
interface ExceptionRow {
  id: string; kind: ExceptionKind; at: string; day: string; hour: number;
  personId: string; person: string; terminalId: string | null;
  amount: number | null; reason: string | null; approver: string | null; detail: string;
}
interface Exceptions {
  range: { from: string; to: string };
  rows: ExceptionRow[];
  summary: {
    total: number;
    byKind: Record<ExceptionKind, number>;
    amountByKind: Record<ExceptionKind, number>;
    byPerson: { personId: string; person: string; count: number; amount: number }[];
    byHour: { hour: number; count: number }[];
  };
}
const EXCEPTION_KINDS: ExceptionKind[] = ["VOID", "DISCOUNT", "REFUND", "CANCEL", "CASH_VARIANCE", "AFTER_HOURS_SIGNIN"];

const MOVEMENT_BADGE: Record<string, string> = {
  PURCHASE_RECEIPT: "ok",
  SALE_CONSUMPTION: "info",
  WASTAGE: "danger",
  STOCKTAKE_ADJUSTMENT: "warn",
  RETURN: "muted",
};

const today = () => new Date().toISOString().slice(0, 10);

export default function ReportsAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const { can } = useAuth();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const currency = settings?.restaurant?.currency ?? "USD";

  const { data: items } = useQuery({ queryKey: ["rep-items", from, to], queryFn: () => apiGet<{ rows: ItemRow[] }>("/reports/items", { from, to }) });
  const { data: hourly } = useQuery({ queryKey: ["rep-hourly", from, to], queryFn: () => apiGet<{ rows: HourRow[] }>("/reports/hourly", { from, to }) });
  const { data: employees } = useQuery({ queryKey: ["rep-emp", from, to], queryFn: () => apiGet<{ rows: EmpRow[] }>("/reports/employees", { from, to }) });
  const { data: food } = useQuery({ queryKey: ["rep-food", from, to], queryFn: () => apiGet<FoodCost>("/reports/food-cost", { from, to }) });
  const { data: wastage } = useQuery({ queryKey: ["rep-wastage", from, to], queryFn: () => apiGet<Wastage>("/reports/wastage", { from, to }) });
  const { data: stock } = useQuery({ queryKey: ["rep-stock", from, to], queryFn: () => apiGet<{ rows: StockRow[] }>("/reports/stock", { from, to }) });
  const { data: exceptions } = useQuery({
    queryKey: ["rep-exceptions", from, to],
    queryFn: () => apiGet<Exceptions>("/reports/exceptions", {
      from: new Date(`${from}T00:00:00.000Z`).toISOString(),
      to: new Date(`${to}T23:59:59.999Z`).toISOString(),
    }),
    enabled: can("audit.view"),
  });

  const maxSales = Math.max(1, ...(hourly?.rows ?? []).map((r) => r.sales));
  const typeLabel = (type: string) => t(`admin:mt_${type.toLowerCase()}`, { defaultValue: type.replace(/_/g, " ") });

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <Field label={t("admin:fld_from")}><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t("admin:fld_to")}><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="spacer" />
        <a className="btn" href={`/api/v1/reports/items?from=${from}&to=${to}&format=csv`}>{t("admin:rep_export_items")}</a>
        <a className="btn" href={`/api/v1/reports/stock?from=${from}&to=${to}&format=csv`}>{t("admin:rep_export_stock")}</a>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="v">{formatMoney(food?.netSales ?? 0, currency)}</div><div className="l">{t("admin:dash_net_sales")}</div></div>
        <div className="stat"><div className="v">{formatMoney(food?.usageCost ?? 0, currency)}</div><div className="l">{t("admin:rep_food_cost")}</div></div>
        <div className="stat"><div className="v">{((food?.foodCostPercent ?? 0) * 100).toFixed(1)}%</div><div className="l">{t("admin:rep_food_cost_pct")}</div></div>
        <div className="stat"><div className="v">{formatMoney(wastage?.totalCost ?? 0, currency)}</div><div className="l">{t("admin:rep_wastage_cost")}</div></div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>{t("admin:rep_top_items")}</h3>
          <table className="tbl">
            <thead><tr><th>{t("admin:col_item")}</th><th>{t("admin:col_category")}</th><th>{t("admin:col_qty")}</th><th style={{ textAlign: "right" }}>{t("admin:col_revenue")}</th></tr></thead>
            <tbody>
              {(items?.rows ?? []).slice(0, 12).map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td><td className="small muted">{r.category}</td><td>{r.qty}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{formatMoney(r.revenue, currency)}</td>
                </tr>
              ))}
              {(items?.rows ?? []).length === 0 && <tr><td colSpan={4} className="muted">{t("admin:rep_no_data")}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>{t("admin:rep_sales_by_employee")}</h3>
          <table className="tbl">
            <thead><tr><th>{t("admin:col_name")}</th><th>{t("admin:col_role")}</th><th>{t("admin:col_orders")}</th><th style={{ textAlign: "right" }}>{t("admin:col_sales")}</th></tr></thead>
            <tbody>
              {(employees?.rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td><td className="small muted">{r.role}</td><td>{r.orders}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{formatMoney(r.sales, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>{t("admin:rep_hourly_sales")}</h3>
          {(hourly?.rows ?? []).filter((r) => r.sales > 0 || r.orders > 0).map((r) => (
            <div className="row" key={r.hour} style={{ marginBottom: 4 }}>
              <span className="muted small" style={{ width: 44 }}>{String(r.hour).padStart(2, "0")}:00</span>
              <div style={{ flex: 1, background: "var(--panel-2)", borderRadius: 6, height: 18, overflow: "hidden" }}>
                <div style={{ width: `${(r.sales / maxSales) * 100}%`, background: "var(--brand)", height: "100%" }} />
              </div>
              <span className="mono small" style={{ width: 90, textAlign: "right" }}>{formatMoney(r.sales, currency)}</span>
            </div>
          ))}
          {(hourly?.rows ?? []).every((r) => r.sales === 0 && r.orders === 0) && <p className="muted small">{t("admin:rep_no_sales_range")}</p>}
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>{t("admin:rep_wastage")}</h3>
          <table className="tbl">
            <thead>
              <tr><th>{t("admin:col_time")}</th><th>{t("admin:col_ingredient")}</th><th style={{ textAlign: "right" }}>{t("admin:col_qty")}</th><th style={{ textAlign: "right" }}>{t("admin:col_cost")}</th><th>{t("admin:col_reason")}</th></tr>
            </thead>
            <tbody>
              {(wastage?.rows ?? []).slice(0, 20).map((r, i) => (
                <tr key={`${r.ingredientName}-${i}`}>
                  <td className="small muted">{new Date(r.at).toLocaleString()}</td>
                  <td>{r.ingredientName}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{r.quantity} {r.unit}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{formatMoney(Math.round(r.cost * 100), currency)}</td>
                  <td className="small muted">{r.reason ?? "—"}</td>
                </tr>
              ))}
              {(wastage?.rows ?? []).length === 0 && <tr><td colSpan={5} className="muted">{t("admin:rep_no_wastage")}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>{t("admin:rep_stock_movements")}</h3>

          <table className="tbl">
            <thead>
              <tr><th>{t("admin:col_time")}</th><th>{t("admin:col_ingredient")}</th><th>{t("admin:col_type")}</th><th style={{ textAlign: "right" }}>{t("admin:col_qty")}</th><th>{t("admin:col_reason")}</th></tr>
            </thead>
            <tbody>
              {(stock?.rows ?? []).slice(0, 25).map((m) => {
                const qty = Number(m.quantity);
                return (
                  <tr key={m.id}>
                    <td className="small muted">{new Date(m.createdAt).toLocaleString()}</td>
                    <td>{m.ingredient.name}</td>
                    <td><span className={`badge ${MOVEMENT_BADGE[m.type] ?? "muted"}`}>{typeLabel(m.type)}</span></td>
                    <td className="mono" style={{ textAlign: "right" }}>{qty > 0 ? "+" : "−"}{Math.abs(qty)} {m.ingredient.stockUnit}</td>
                    <td className="small muted">{m.reason ?? "—"}</td>
                  </tr>
                );
              })}
              {(stock?.rows ?? []).length === 0 && <tr><td colSpan={5} className="muted">{t("admin:rep_no_movements")}</td></tr>}
            </tbody>
          </table>
        </div>

        {can("audit.view") && (
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h3>{t("admin:exc_title")}</h3>
            <p className="muted small">{t("admin:exc_hint")}</p>
            <div className="grid cols-4" style={{ marginBottom: 10 }}>
              {EXCEPTION_KINDS.map((kind) => (
                <div className="stat" key={kind}>
                  <div className="v">{exceptions?.summary.byKind[kind] ?? 0}</div>
                  <div className="l">
                    {t(`admin:exc_${kind.toLowerCase()}`, { defaultValue: kind.replace(/_/g, " ") })}
                    {" · "}
                    {formatMoney(Math.round((exceptions?.summary.amountByKind[kind] ?? 0) * 100), currency)}
                  </div>
                </div>
              ))}
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("admin:exc_day_hour")}</th><th>{t("admin:col_type")}</th><th>{t("admin:col_name")}</th>
                  <th>{t("admin:col_detail")}</th><th style={{ textAlign: "right" }}>{t("admin:col_amount")}</th>
                  <th>{t("admin:col_reason")}</th><th>{t("admin:exc_approver")}</th>
                </tr>
              </thead>
              <tbody>
                {(exceptions?.rows ?? []).slice(0, 200).map((r) => (
                  <tr key={r.id}>
                    <td className="small muted">{r.day} {String(r.hour).padStart(2, "0")}:00</td>
                    <td><span className={`badge ${r.kind === "VOID" || r.kind === "REFUND" || r.kind === "CASH_VARIANCE" ? "danger" : "warn"}`}>
                      {t(`admin:exc_${r.kind.toLowerCase()}`, { defaultValue: r.kind.replace(/_/g, " ") })}
                    </span></td>
                    <td>{r.person}</td>
                    <td className="small muted">{r.detail}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{r.amount == null ? "—" : formatMoney(Math.round(r.amount * 100), currency)}</td>
                    <td className="small muted">{r.reason ?? "—"}</td>
                    <td className="small">{r.approver ?? "—"}</td>
                  </tr>
                ))}
                {(exceptions?.rows ?? []).length === 0 && <tr><td colSpan={7} className="muted">{t("admin:exc_none")}</td></tr>}
              </tbody>
            </table>
            {(exceptions?.summary.byPerson.length ?? 0) > 0 && (
              <p className="muted small" style={{ marginTop: 8 }}>
                {t("admin:exc_by_person")}: {exceptions!.summary.byPerson.map((p) => `${p.person} (${p.count})`).join(" · ")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

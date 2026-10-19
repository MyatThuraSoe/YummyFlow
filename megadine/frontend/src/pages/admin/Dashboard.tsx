import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../../lib/api";
import { formatMoney } from "../../lib/format";

interface Dash { todaySales: number; todayOrders: number; openShifts: number; lowStockCount: number; activeOrders: number; activeTables: number }
interface Daily {
  report: {
    orderCount: number;
    grossSales: number;
    netSales: number;
    refundTotal: number;
    discounts: number;
    tax: number;
    avgTicket: number;
    cancelledOrders: number;
    byMethod: Record<string, number>;
    byCategory: Record<string, { qty: number; revenue: number }>;
    byEmployee: Record<string, { name: string; orders: number; sales: number }>;
  };
}
interface Settings { restaurant: { currency: string } | null }
type AlertItem =
  | { id: string; kind: "LOW_STOCK"; severity: "warn" | "danger"; name: string; stock: number; unit: string; reorderLevel: number }
  | { id: string; kind: "KDS_OVERDUE"; severity: "danger"; orderNumber: number; station: string; minutes: number }
  | { id: string; kind: "RESERVATION_SOON"; severity: "info"; customerName: string; tableNumber: number; partySize: number; minutesUntil: number };
interface TrendDay { date: string; orders: number; sales: number }

export default function Dashboard() {
  const { t } = useTranslation(["admin", "common"]);
  const nav = useNavigate();
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<Dash>("/reports/dashboard"), refetchInterval: 15000 });
  const { data: daily } = useQuery({ queryKey: ["daily"], queryFn: () => apiGet<Daily>("/reports/daily"), refetchInterval: 30000 });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const { data: alertsData } = useQuery({ queryKey: ["admin-alerts"], queryFn: () => apiGet<{ alerts: AlertItem[] }>("/reports/alerts"), refetchInterval: 30000 });
  const { data: trendData } = useQuery({ queryKey: ["trend", 7], queryFn: () => apiGet<{ days: TrendDay[] }>("/reports/trend", { days: "7" }), refetchInterval: 60000 });
  const currency = settings?.restaurant?.currency ?? "USD";
  const r = daily?.report;
  const alerts = alertsData?.alerts ?? [];
  const trend = trendData?.days ?? [];
  const trendMax = Math.max(1, ...trend.map((d) => d.sales));

  const cards = [
    { l: t("admin:dash_today_sales"), v: formatMoney(dash?.todaySales ?? 0, currency) },
    { l: t("admin:dash_today_orders"), v: dash?.todayOrders ?? 0 },
    { l: t("admin:dash_active_orders"), v: dash?.activeOrders ?? 0 },
    { l: t("admin:dash_open_shifts"), v: dash?.openShifts ?? 0 },
    { l: t("admin:dash_low_stock"), v: dash?.lowStockCount ?? 0 },
    { l: t("admin:dash_avg_ticket"), v: formatMoney(r?.avgTicket ?? 0, currency) },
    { l: t("admin:dash_net_sales"), v: formatMoney(r?.netSales ?? 0, currency) },
    { l: t("admin:dash_gross_sales"), v: formatMoney(r?.grossSales ?? 0, currency) },
    { l: t("admin:dash_discounts"), v: formatMoney(r?.discounts ?? 0, currency) },
    { l: t("admin:dash_tax"), v: formatMoney(r?.tax ?? 0, currency) },
    { l: t("admin:dash_refunds"), v: formatMoney(r?.refundTotal ?? 0, currency) },
    { l: t("admin:dash_cancelled_orders"), v: r?.cancelledOrders ?? 0 },
  ];

  const alertMessage = (a: AlertItem) => {
    if (a.kind === "LOW_STOCK") return t("admin:alert_low_stock", { name: a.name, stock: a.stock.toFixed(2), unit: a.unit });
    if (a.kind === "KDS_OVERDUE") return t("admin:alert_kds_overdue", { number: a.orderNumber, minutes: a.minutes, station: a.station });
    return t("admin:alert_res_soon", { name: a.customerName, minutes: a.minutesUntil, table: a.tableNumber, count: a.partySize });
  };
  const alertAction = (a: AlertItem) => {
    if (a.kind === "LOW_STOCK") return { label: t("admin:alert_action_reorder"), to: "/admin/inventory" };
    if (a.kind === "KDS_OVERDUE") return { label: t("admin:alert_action_view"), to: "/kds" };
    return { label: t("admin:alert_action_prepare"), to: "/floor" };
  };

  const categoriesByRevenue = Object.entries(r?.byCategory ?? {}).sort((a, b) => b[1].revenue - a[1].revenue);
  const topCategory = categoriesByRevenue[0];
  const categoryShare = topCategory && r && r.grossSales > 0 ? Math.round((topCategory[1].revenue / r.grossSales) * 100) : null;
  const topEmployee = Object.values(r?.byEmployee ?? {}).sort((a, b) => b.sales - a.sales)[0];
  const cancelRate = r && r.orderCount + r.cancelledOrders > 0 ? Math.round((r.cancelledOrders / (r.orderCount + r.cancelledOrders)) * 100) : 0;
  const refundRate = r && r.grossSales > 0 ? Math.round((r.refundTotal / r.grossSales) * 100) : 0;
  const hasInsights = !!topCategory || !!topEmployee;

  return (
    <div>
      {alerts.length > 0 && (
        <div className="alerts-banner">
          <span className="alerts-icon">⚠</span>
          <div className="alerts-list">
            {alerts.map((a) => {
              const action = alertAction(a);
              return (
                <div key={a.id} className={`alert ${a.severity}`}>
                  <span className="alert-message">{alertMessage(a)}</span>
                  <button className="alert-action" onClick={() => nav(action.to)}>
                    {action.label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="metrics-ticker">
        <div className="metric">
          <span className="metric-label">{t("admin:dash_ticker_orders")}</span>
          <span className="metric-value">{dash?.todayOrders ?? 0}</span>
        </div>
        <div className="metric">
          <span className="metric-label">{t("admin:dash_ticker_revenue")}</span>
          <span className="metric-value">{formatMoney(dash?.todaySales ?? 0, currency)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">{t("admin:dash_ticker_avg")}</span>
          <span className="metric-value">{formatMoney(r?.avgTicket ?? 0, currency)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">{t("admin:dash_ticker_tables")}</span>
          <span className="metric-value">{dash?.activeTables ?? 0}</span>
        </div>
      </div>

      <div className="grid cols-4">
        {cards.map((c) => (
          <div className="stat" key={c.l}>
            <div className="v">{c.v}</div>
            <div className="l">{c.l}</div>
          </div>
        ))}

        <div className="card" style={{ gridColumn: "span 2" }}>
          <h3>{t("admin:dash_payment_mix")}</h3>
          {Object.entries(r?.byMethod ?? {}).map(([k, v]) => (
            <div className="totals-row" key={k}>
              <span className="muted">{k}</span>
              <span className="mono">{formatMoney(v, currency)}</span>
            </div>
          ))}
          {Object.keys(r?.byMethod ?? {}).length === 0 && <p className="muted small">{t("admin:dash_no_sales")}</p>}
        </div>

        <div className="card" style={{ gridColumn: "span 2" }}>
          <h3>{t("admin:dash_top_categories")}</h3>
          {categoriesByRevenue
            .slice(0, 6)
            .map(([k, v]) => (
              <div className="totals-row" key={k}>
                <span className="muted">{k} · {v.qty}</span>
                <span className="mono">{formatMoney(v.revenue, currency)}</span>
              </div>
            ))}
          {categoriesByRevenue.length === 0 && <p className="muted small">{t("admin:dash_no_sales")}</p>}
        </div>

        <div className="card trend-card" style={{ gridColumn: "span 2" }}>
          <h3>{t("admin:dash_trend_title")}</h3>
          <div className="trend-bars">
            {trend.map((d) => (
              <div
                className="trend-bar-wrap"
                key={d.date}
                title={t("admin:dash_trend_tooltip", { sales: formatMoney(d.sales, currency), orders: d.orders })}
              >
                <div className="trend-bar" style={{ height: `${Math.max(3, Math.round((d.sales / trendMax) * 100))}%` }} />
                <span className="trend-day">{new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ gridColumn: "span 2" }}>
          <h3>{t("admin:dash_insights_title")}</h3>
          {!hasInsights && <p className="muted small">{t("admin:dash_insight_none")}</p>}
          {topCategory && categoryShare !== null && (
            <p className="insight-line">💡 {t("admin:dash_insight_top_category", { category: topCategory[0], share: categoryShare })}</p>
          )}
          {topEmployee && (
            <p className="insight-line">🏆 {t("admin:dash_insight_top_employee", { name: topEmployee.name, orders: topEmployee.orders })}</p>
          )}
          {hasInsights && <p className="insight-line">📉 {t("admin:dash_insight_cancel_rate", { rate: cancelRate })}</p>}
          {hasInsights && <p className="insight-line">↩️ {t("admin:dash_insight_refund_rate", { rate: refundRate })}</p>}
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>{t("admin:dash_staff_performance")}</h3>
          <table className="tbl">
            <thead>
              <tr><th>{t("admin:col_name")}</th><th>{t("admin:col_orders")}</th><th style={{ textAlign: "right" }}>{t("admin:col_sales")}</th></tr>
            </thead>
            <tbody>
              {Object.values(r?.byEmployee ?? {}).map((e) => (
                <tr key={e.name}>
                  <td>{e.name}</td>
                  <td>{e.orders}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{formatMoney(e.sales, currency)}</td>
                </tr>
              ))}
              {Object.keys(r?.byEmployee ?? {}).length === 0 && (
                <tr><td colSpan={3} className="muted">{t("admin:dash_no_completed")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

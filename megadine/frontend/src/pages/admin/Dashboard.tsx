import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "../../lib/api";
import { formatMoney } from "../../lib/format";

interface Dash { todaySales: number; todayOrders: number; openShifts: number; lowStockCount: number; activeOrders: number }
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

export default function Dashboard() {
  const { t } = useTranslation(["admin", "common"]);
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<Dash>("/reports/dashboard"), refetchInterval: 20000 });
  const { data: daily } = useQuery({ queryKey: ["daily"], queryFn: () => apiGet<Daily>("/reports/daily") });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const currency = settings?.restaurant?.currency ?? "USD";
  const r = daily?.report;

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

  return (
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
        {Object.entries(r?.byCategory ?? {})
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .slice(0, 6)
          .map(([k, v]) => (
            <div className="totals-row" key={k}>
              <span className="muted">{k} · {v.qty}</span>
              <span className="mono">{formatMoney(v.revenue, currency)}</span>
            </div>
          ))}
        {Object.keys(r?.byCategory ?? {}).length === 0 && <p className="muted small">{t("admin:dash_no_sales")}</p>}
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
  );
}

import { useQuery } from "@tanstack/react-query";
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
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<Dash>("/reports/dashboard"), refetchInterval: 20000 });
  const { data: daily } = useQuery({ queryKey: ["daily"], queryFn: () => apiGet<Daily>("/reports/daily") });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const currency = settings?.restaurant?.currency ?? "USD";
  const r = daily?.report;

  const cards = [
    { l: "Today sales", v: formatMoney(dash?.todaySales ?? 0, currency) },
    { l: "Today orders", v: dash?.todayOrders ?? 0 },
    { l: "Active orders", v: dash?.activeOrders ?? 0 },
    { l: "Open shifts", v: dash?.openShifts ?? 0 },
    { l: "Low stock items", v: dash?.lowStockCount ?? 0 },
    { l: "Avg ticket", v: formatMoney(r?.avgTicket ?? 0, currency) },
    { l: "Net sales", v: formatMoney(r?.netSales ?? 0, currency) },
    { l: "Gross sales", v: formatMoney(r?.grossSales ?? 0, currency) },
    { l: "Discounts", v: formatMoney(r?.discounts ?? 0, currency) },
    { l: "Tax", v: formatMoney(r?.tax ?? 0, currency) },
    { l: "Refunds", v: formatMoney(r?.refundTotal ?? 0, currency) },
    { l: "Cancelled orders", v: r?.cancelledOrders ?? 0 },
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
        <h3>Payment mix</h3>
        {Object.entries(r?.byMethod ?? {}).map(([k, v]) => (
          <div className="totals-row" key={k}>
            <span className="muted">{k}</span>
            <span className="mono">{formatMoney(v, currency)}</span>
          </div>
        ))}
        {Object.keys(r?.byMethod ?? {}).length === 0 && <p className="muted small">No sales yet today.</p>}
      </div>

      <div className="card" style={{ gridColumn: "span 2" }}>
        <h3>Top categories</h3>
        {Object.entries(r?.byCategory ?? {})
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .slice(0, 6)
          .map(([k, v]) => (
            <div className="totals-row" key={k}>
              <span className="muted">{k} · {v.qty}</span>
              <span className="mono">{formatMoney(v.revenue, currency)}</span>
            </div>
          ))}
        {Object.keys(r?.byCategory ?? {}).length === 0 && <p className="muted small">No sales yet today.</p>}
      </div>

      <div className="card" style={{ gridColumn: "1 / -1" }}>
        <h3>Staff performance (today)</h3>
        <table className="tbl">
          <thead>
            <tr><th>Name</th><th>Orders</th><th style={{ textAlign: "right" }}>Sales</th></tr>
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
              <tr><td colSpan={3} className="muted">No completed orders yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

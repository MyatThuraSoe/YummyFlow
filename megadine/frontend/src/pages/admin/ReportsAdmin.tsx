import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { Field } from "../../components/ui";

interface ItemRow { name: string; category: string; qty: number; revenue: number }
interface HourRow { hour: number; orders: number; sales: number }
interface EmpRow { id: string; name: string; role: string; orders: number; sales: number }
interface Settings { restaurant: { currency: string } | null }
interface FoodCost { netSales: number; usageCost: number; foodCostPercent: number }

const today = () => new Date().toISOString().slice(0, 10);

export default function ReportsAdmin() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<Settings>("/admin/settings") });
  const currency = settings?.restaurant?.currency ?? "USD";

  const { data: items } = useQuery({ queryKey: ["rep-items", from, to], queryFn: () => apiGet<{ rows: ItemRow[] }>("/reports/items", { from, to }) });
  const { data: hourly } = useQuery({ queryKey: ["rep-hourly", from, to], queryFn: () => apiGet<{ rows: HourRow[] }>("/reports/hourly", { from, to }) });
  const { data: employees } = useQuery({ queryKey: ["rep-emp", from, to], queryFn: () => apiGet<{ rows: EmpRow[] }>("/reports/employees", { from, to }) });
  const { data: food } = useQuery({ queryKey: ["rep-food", from, to], queryFn: () => apiGet<FoodCost>("/reports/food-cost", { from, to }) });

  const maxSales = Math.max(1, ...(hourly?.rows ?? []).map((r) => r.sales));

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="spacer" />
        <a className="btn" href={`/api/v1/reports/items?from=${from}&to=${to}&format=csv`}>Export items CSV</a>
        <a className="btn" href={`/api/v1/reports/stock?from=${from}&to=${to}&format=csv`}>Export stock CSV</a>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="v">{formatMoney(food?.netSales ?? 0, currency)}</div><div className="l">Net sales</div></div>
        <div className="stat"><div className="v">{formatMoney(food?.usageCost ?? 0, currency)}</div><div className="l">Food cost</div></div>
        <div className="stat"><div className="v">{((food?.foodCostPercent ?? 0) * 100).toFixed(1)}%</div><div className="l">Food cost %</div></div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Top items</h3>
          <table className="tbl">
            <thead><tr><th>Item</th><th>Category</th><th>Qty</th><th style={{ textAlign: "right" }}>Revenue</th></tr></thead>
            <tbody>
              {(items?.rows ?? []).slice(0, 12).map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td><td className="small muted">{r.category}</td><td>{r.qty}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{formatMoney(r.revenue, currency)}</td>
                </tr>
              ))}
              {(items?.rows ?? []).length === 0 && <tr><td colSpan={4} className="muted">No data.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Sales by employee</h3>
          <table className="tbl">
            <thead><tr><th>Name</th><th>Role</th><th>Orders</th><th style={{ textAlign: "right" }}>Sales</th></tr></thead>
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
          <h3>Hourly sales</h3>
          {(hourly?.rows ?? []).filter((r) => r.sales > 0 || r.orders > 0).map((r) => (
            <div className="row" key={r.hour} style={{ marginBottom: 4 }}>
              <span className="muted small" style={{ width: 44 }}>{String(r.hour).padStart(2, "0")}:00</span>
              <div style={{ flex: 1, background: "var(--panel-2)", borderRadius: 6, height: 18, overflow: "hidden" }}>
                <div style={{ width: `${(r.sales / maxSales) * 100}%`, background: "var(--brand)", height: "100%" }} />
              </div>
              <span className="mono small" style={{ width: 90, textAlign: "right" }}>{formatMoney(r.sales, currency)}</span>
            </div>
          ))}
          {(hourly?.rows ?? []).every((r) => r.sales === 0 && r.orders === 0) && <p className="muted small">No sales in range.</p>}
        </div>
      </div>
    </div>
  );
}

import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import Dashboard from "./admin/Dashboard";
import MenuAdmin from "./admin/MenuAdmin";
import TablesAdmin from "./admin/TablesAdmin";
import StaffAdmin from "./admin/StaffAdmin";
import InventoryAdmin from "./admin/InventoryAdmin";
import ExpensesAdmin from "./admin/ExpensesAdmin";
import ReportsAdmin from "./admin/ReportsAdmin";
import ShiftsAdmin from "./admin/ShiftsAdmin";
import SettingsAdmin from "./admin/SettingsAdmin";
import BackupAdmin from "./admin/BackupAdmin";
import AuditAdmin from "./admin/AuditAdmin";

const TABS = [
  { to: "", label: "Dashboard", cap: "report.view", end: true },
  { to: "menu", label: "Menu", cap: "menu.manage" },
  { to: "tables", label: "Tables", cap: "table.manage" },
  { to: "staff", label: "Staff", cap: "staff.manage" },
  { to: "inventory", label: "Inventory", cap: "inventory.view" },
  { to: "expenses", label: "Expenses", cap: "expense.manage" },
  { to: "reports", label: "Reports", cap: "report.view" },
  { to: "shifts", label: "Shifts & Z", cap: "report.view" },
  { to: "settings", label: "Settings", cap: "settings.manage" },
  { to: "backup", label: "Backup", cap: "backup.manage" },
  { to: "audit", label: "Audit", cap: "audit.view" },
];

export default function Admin() {
  const { can } = useAuth();
  return (
    <div>
      <div className="cat-tabs" style={{ marginBottom: 16 }}>
        {TABS.filter((t) => can(t.cap)).map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `cat-tab ${isActive ? "active" : ""}`}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="menu" element={<MenuAdmin />} />
        <Route path="tables" element={<TablesAdmin />} />
        <Route path="staff" element={<StaffAdmin />} />
        <Route path="inventory" element={<InventoryAdmin />} />
        <Route path="expenses" element={<ExpensesAdmin />} />
        <Route path="reports" element={<ReportsAdmin />} />
        <Route path="shifts" element={<ShiftsAdmin />} />
        <Route path="settings" element={<SettingsAdmin />} />
        <Route path="backup" element={<BackupAdmin />} />
        <Route path="audit" element={<AuditAdmin />} />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </div>
  );
}

import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ToastProvider } from "./components/ui";
import { ProtectedRoute, homeForRole } from "./components/ProtectedRoute";
import { useAuth } from "./store/auth";
import Login from "./pages/Login";
import SetupFirstAdmin from "./pages/SetupFirstAdmin";
import Pos from "./pages/Pos";
import Floor from "./pages/Floor";
import Kds from "./pages/Kds";
import DashboardLayout, { ContentSkeleton } from "./components/DashboardLayout";

const Dashboard = lazy(() => import("./pages/admin/Dashboard"));
const MenuAdmin = lazy(() => import("./pages/admin/MenuAdmin"));
const TablesAdmin = lazy(() => import("./pages/admin/TablesAdmin"));
const InventoryAdmin = lazy(() => import("./pages/admin/InventoryAdmin"));
const ExpensesAdmin = lazy(() => import("./pages/admin/ExpensesAdmin"));
const ReportsAdmin = lazy(() => import("./pages/admin/ReportsAdmin"));
const ShiftsAdmin = lazy(() => import("./pages/admin/ShiftsAdmin"));
const OrdersAdmin = lazy(() => import("./pages/admin/OrdersAdmin"));
const BackupAdmin = lazy(() => import("./pages/admin/BackupAdmin"));
const AuditAdmin = lazy(() => import("./pages/admin/AuditAdmin"));
const UsersAdmin = lazy(() => import("./pages/admin/UsersAdmin"));
const UserFormAdmin = lazy(() => import("./pages/admin/UserFormAdmin"));
const SettingsHub = lazy(() => import("./pages/admin/SettingsHub"));
const SystemSettingsAdmin = lazy(() => import("./pages/admin/SystemSettingsAdmin"));
const ReceiptCustomization = lazy(() => import("./pages/admin/ReceiptCustomization"));
const ReceiptOrderAdmin = lazy(() => import("./pages/admin/ReceiptOrderAdmin"));
const LanguageSettings = lazy(() => import("./pages/admin/LanguageSettings"));
const ShopInfoAdmin = lazy(() => import("./pages/admin/ShopInfoAdmin"));
const Activate = lazy(() => import("./pages/admin/Activate"));
const About = lazy(() => import("./pages/admin/About"));

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeForRole(user.role)} replace />;
}

export default function App() {
  const { hydrate, ready, user } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!ready) return;
    const onAuth = () => {
      sessionStorage.setItem("md_session_expired_message", "1");
      nav("/login");
    };
    window.addEventListener("md:unauthorized", onAuth);
    return () => window.removeEventListener("md:unauthorized", onAuth);
  }, [ready, nav]);

  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={user ? <Navigate to={homeForRole(user.role)} replace /> : <Login />} />
        <Route path="/setup" element={<SetupFirstAdmin />} />
        <Route
          path="/activate"
          element={
            <ProtectedRoute>
              <Suspense fallback={<ContentSkeleton />}>
                <Activate />
              </Suspense>
            </ProtectedRoute>
          }
        />

        <Route
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/pos" element={<ProtectedRoute capability="pos.use"><Pos /></ProtectedRoute>} />
          <Route path="/floor" element={<ProtectedRoute capability="table.manage"><Floor /></ProtectedRoute>} />
          <Route path="/kds" element={<ProtectedRoute capability="kds.view"><Kds /></ProtectedRoute>} />

          <Route path="/admin">
            <Route
              index
              element={
                <AdminGuard capability="report.view">
                  <Suspense fallback={<ContentSkeleton />}>
                    <Dashboard />
                  </Suspense>
                </AdminGuard>
              }
            />
            <Route path="menu" element={<AdminGuard capability="menu.manage"><Lazy page={<MenuAdmin />} /></AdminGuard>} />
            <Route path="tables" element={<AdminGuard capability="table.manage"><Lazy page={<TablesAdmin />} /></AdminGuard>} />
            <Route path="inventory" element={<AdminGuard capability="inventory.view"><Lazy page={<InventoryAdmin />} /></AdminGuard>} />
            <Route path="expenses" element={<AdminGuard capability="expense.manage"><Lazy page={<ExpensesAdmin />} /></AdminGuard>} />
            <Route path="reports" element={<AdminGuard capability="report.view"><Lazy page={<ReportsAdmin />} /></AdminGuard>} />
            <Route path="orders" element={<AdminGuard capability="report.view"><Lazy page={<OrdersAdmin />} /></AdminGuard>} />
            <Route path="shifts" element={<AdminGuard capability="report.view"><Lazy page={<ShiftsAdmin />} /></AdminGuard>} />
            <Route path="backup" element={<AdminGuard capability="backup.manage"><Lazy page={<BackupAdmin />} /></AdminGuard>} />
            <Route path="audit" element={<AdminGuard capability="audit.view"><Lazy page={<AuditAdmin />} /></AdminGuard>} />
            <Route path="users" element={<AdminGuard capability="staff.manage"><Lazy page={<UsersAdmin />} /></AdminGuard>} />
            <Route path="users/new" element={<AdminGuard capability="staff.manage"><Lazy page={<UserFormAdmin />} /></AdminGuard>} />
            <Route path="users/:id" element={<AdminGuard capability="staff.manage"><Lazy page={<UserFormAdmin />} /></AdminGuard>} />
            <Route path="settings" element={<AdminGuard capability="settings.manage"><Lazy page={<SettingsHub />} /></AdminGuard>} />
            <Route path="settings/system" element={<AdminGuard capability="settings.manage"><Lazy page={<SystemSettingsAdmin />} /></AdminGuard>} />
            <Route path="settings/receipt" element={<Navigate to="/admin/receipt-customization" replace />} />
            <Route path="settings/language" element={<Lazy page={<LanguageSettings />} />} />
            <Route path="receipt-customization" element={<AdminGuard capability="settings.manage"><Lazy page={<ReceiptCustomization />} /></AdminGuard>} />
            <Route path="receipt/:orderId" element={<AdminGuard capability="report.view"><Lazy page={<ReceiptOrderAdmin />} /></AdminGuard>} />
            <Route path="shop-info" element={<AdminGuard capability="settings.manage"><Lazy page={<ShopInfoAdmin />} /></AdminGuard>} />
            <Route path="license" element={<AdminGuard capability="settings.manage"><Lazy page={<Activate />} /></AdminGuard>} />
            <Route path="about" element={<Lazy page={<About />} />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}

function AdminGuard({ capability, children }: { capability: string; children: React.ReactNode }) {
  return <ProtectedRoute capability={capability}>{children}</ProtectedRoute>;
}

function Lazy({ page }: { page: React.ReactNode }) {
  return <Suspense fallback={<ContentSkeleton />}>{page}</Suspense>;
}

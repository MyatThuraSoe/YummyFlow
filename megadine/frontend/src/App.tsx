import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ToastProvider } from "./components/ui";
import { Layout } from "./components/Layout";
import { ProtectedRoute, homeForRole } from "./components/ProtectedRoute";
import { useAuth } from "./store/auth";
import Login from "./pages/Login";
import Pos from "./pages/Pos";
import Floor from "./pages/Floor";
import Kds from "./pages/Kds";
import Admin from "./pages/Admin";

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
    const onAuth = () => nav("/login");
    window.addEventListener("md:unauthorized", onAuth);
    return () => window.removeEventListener("md:unauthorized", onAuth);
  }, [ready, nav]);

  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={user ? <Navigate to={homeForRole(user.role)} replace /> : <Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/pos" element={<ProtectedRoute capability="pos.use"><Pos /></ProtectedRoute>} />
          <Route path="/floor" element={<ProtectedRoute capability="table.manage"><Floor /></ProtectedRoute>} />
          <Route path="/kds" element={<ProtectedRoute capability="kds.view"><Kds /></ProtectedRoute>} />
          <Route path="/admin/*" element={<ProtectedRoute capability="report.view"><Admin /></ProtectedRoute>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}

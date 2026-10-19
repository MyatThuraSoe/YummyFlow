import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../store/auth";

export function ProtectedRoute({ children, capability }: { children: ReactNode; capability?: string }) {
  const { user, ready, can } = useAuth();
  const location = useLocation();

  if (!ready) return <div className="content">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (capability && !can(capability)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function homeForRole(role: string): string {
  switch (role) {
    case "OWNER":
    case "ADMIN":
    case "MANAGER":
      return "/admin";
    case "KITCHEN":
      return "/kds";
    case "WAITER":
      return "/floor";
    case "CASHIER":
    default:
      return "/pos";
  }
}

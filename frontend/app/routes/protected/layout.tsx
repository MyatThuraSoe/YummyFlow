import { Outlet, useNavigate, useLocation, Navigate } from "react-router";
import toast from "react-hot-toast";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "@/components/sidebar/app-sidebar";
import { authClient } from "@/lib/auth-client";
import Loader from "@/components/global/Loader";
import type { roles } from "@/type";
import { useEffect } from "react";
import { data, getRouteConfig } from "@/components/sidebar/nav-data";

const DasboardLayout = () => {
  const {
    data: session,
    isPending, //loading state
    error, //error object
  } = authClient.useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // instead of the the ealier approach we will be using a useEffect hook and nav-data.ts
  // 1. Get current User Role (default to patient/guest)
  const userRole = (session?.user?.role as roles) || "CUSTOMER";

  // 2. Find configuration for current path
  // We combine all arrays to search through everything.
  // Normalised first: React Router matches `/dashboard/` to the `/dashboard`
  // route, but a raw string compare against the nav url returned null, which
  // silently skipped the check for any URL typed with a trailing slash.
  const allNavItems = [...data.adminNav, ...data.posNav];
  const normalisedPath =
    pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const currentRouteConfig = getRouteConfig(normalisedPath, allNavItems);

  // 3. Check permissions DURING render, not in an effect.
  //
  // This used to run in a useEffect that fired *after* <Outlet /> had already
  // rendered the page, so an unauthorised user briefly mounted every protected
  // screen and its queries ran — firing the dashboard, orders, inventory and
  // day-close requests — before the redirect landed. Gating here means the page
  // never mounts, so the requests are never made.
  const denied = Boolean(
    currentRouteConfig && !currentRouteConfig.allowedRoles.includes(userRole),
  );

  useEffect(() => {
    if (denied) {
      toast.error("Unauthorized Access");
      // Redirect to a safe page based on role, or just dashboard
      navigate("/", { replace: true });
    }
  }, [denied, navigate]);

  if (isPending) {
    return <Loader title="Loading user session..." className="min-h-screen" />;
  }

  if (error) {
    toast.error("Failed to load user session. Please try again.");
  }

  // Redirect if logged in
  if (!session) {
    return <Navigate to="/signin" replace />;
  }

  // Block the render itself. Returning the loader (not the outlet) is what stops
  // the page below from mounting and firing its queries.
  if (denied) {
    return <Loader title="Checking access..." className="min-h-screen" />;
  }
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "19rem",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="bg-card/50">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
};

export default DasboardLayout;

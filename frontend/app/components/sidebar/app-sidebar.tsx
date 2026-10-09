import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { LogOut, Settings, UserIcon, Utensils } from "lucide-react";
import { Link, Navigate } from "react-router";
import NavItem from "./NavItem";
import type { roles } from "@/type";
import { authClient } from "@/lib/auth-client";
import { data, type NavItemType } from "./nav-data";
import Theme from "./Theme";
import toast from "react-hot-toast";

const AppSidebar = () => {
  const { data: session } = authClient.useSession();
  const userRole: roles = (session?.user?.role as roles) || "CUSTOMER";

  const filterNav = (items: NavItemType[]) => {
    return items.filter((item) => item.allowedRoles.includes(userRole));
  };
  const filterPosNav = filterNav(data.posNav);
  const filterAdminNav = filterNav(data.adminNav);

  // logout
  const logout = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          <Navigate to="/signin" replace />;
          toast.success("Logged out successfully");
        },
      },
    });
  };
  return (
    <Sidebar className="border-r">
      <SidebarHeader className="mt-2">
        {/* Brand Logo & Collapse */}
        <Link to="/" className="flex items-center gap-3">
          <span className="rounded-lg bg-primary/30 p-2 text-primary">
            <Utensils />
          </span>
          <h1 className="text-xl font-extrabold tracking-tight text-foreground">
            DineFlow
          </h1>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {/* ==================================================== */}
        {/* ADMIN SECTION (With '+' Action Button from image) */}
        {/* ==================================================== */}
        <NavItem items={filterAdminNav} title="Administration" />

        {/* ==================================================== */}
        {/* POS SECTION (Using Collapsible & Primary Color Active) */}
        {/* ==================================================== */}
        <NavItem items={filterPosNav} title="Point of Sale" />
      </SidebarContent>
      <SidebarFooter className="bg-primary/5 shadow-xl rounded-lg m-2 p-2 pt-2">
        <SidebarMenu className="space-y-1">
          <SidebarMenuItem className="flex justify-end">
            <Theme />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="border rounded-lg p-2 w-full flex items-center"
            >
              <div className="flex items-center gap-3">
                <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground overflow-hidden shadow-sm">
                  {session?.user?.image ? (
                    <img
                      src={session.user.image}
                      alt={session.user.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <UserIcon className="size-4" />
                  )}
                </div>
                <div className="flex flex-col items-start text-sm leading-tight">
                  <span className="font-semibold text-foreground">
                    {session?.user?.name || "Admin User"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {session?.user?.email || "admin@restaurant.com"}
                  </span>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* Additional Footer Actions */}
          <SidebarMenuItem>
            <SidebarMenuButton className="text-muted-foreground hover:text-foreground font-medium">
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <SidebarMenuButton
              className="text-muted-foreground hover:text-red-500 font-medium transition-colors"
              onClick={logout}
            >
              <LogOut className="h-4 w-4" />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AppSidebar;

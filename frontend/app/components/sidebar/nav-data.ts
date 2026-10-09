import {
  CalendarDays,
  ChefHat,
  MonitorSmartphone,
  UtensilsCrossed,
  LayoutDashboard,
  type LucideIcon,
  Users2,
  Package,
} from "lucide-react";
import type { roles } from "@/type";

export interface NavItemType {
  title: string;
  url: string;
  icon?: LucideIcon;
  allowedRoles: roles[];
  items?: {
    title: string;
    url: string;
    allowedRoles?: roles[];
    isActive?: boolean;
  }[];
}
// Data Structure (Wired with your Restaurant logic)
export const data: {
  adminNav: NavItemType[];
  posNav: NavItemType[];
} = {
  adminNav: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      allowedRoles: ["ADMIN", "MANAGER"],
      items: [
        {
          title: "Overview",
          url: "/dashboard",
          allowedRoles: ["ADMIN", "MANAGER"],
        },
        {
          title: "Day Close",
          url: "/reports/day-close",
          allowedRoles: ["ADMIN", "MANAGER"],
        },
        {
          title: "Activities Log",
          url: "/admin/activities-log",
          allowedRoles: ["ADMIN", "MANAGER"],
        },
      ],
    },
    {
      title: "Menu Management",
      url: "/admin/menu",
      icon: UtensilsCrossed,
      allowedRoles: ["ADMIN", "MANAGER"],
      items: [
        {
          title: "All Menu Items",
          url: "/admin/menu",
          allowedRoles: ["ADMIN", "MANAGER"],
        },
        {
          title: "Categories & Create Item",
          url: "/admin/menu/items-categories/create",
          allowedRoles: ["ADMIN", "MANAGER"],
        },
      ],
    },
    {
      title: "Bookings",
      url: "/admin/reservations",
      icon: CalendarDays,
      allowedRoles: ["ADMIN", "MANAGER", "STAFF"],
      items: [
        {
          title: "Reservations",
          url: "/admin/reservations",
          allowedRoles: ["ADMIN", "MANAGER", "STAFF"],
        },
      ],
    },
    {
      title: "Inventory",
      url: "/admin/inventory",
      icon: Package,
      allowedRoles: ["ADMIN", "MANAGER"],
      items: [
        {
          title: "Stock & Recipes",
          url: "/admin/inventory",
          allowedRoles: ["ADMIN", "MANAGER"],
        },
      ],
    },
    {
      title: "Users & Staff",
      url: "/admin/users",
      icon: Users2,
      allowedRoles: ["ADMIN", "MANAGER", "STAFF"],
      items: [
        {
          title: "User Management",
          url: "/admin/users",
          allowedRoles: ["ADMIN", "MANAGER", "STAFF"],
        },
        {
          title: "Notifications",
          url: "/admin/notifications",
          allowedRoles: ["ADMIN", "MANAGER"],
        },
      ],
    },
  ],
  posNav: [
    {
      title: "Point of Sale",
      url: "/pos",
      icon: MonitorSmartphone,
      allowedRoles: ["ADMIN", "MANAGER", "STAFF"],
      items: [
        {
          title: "Active Orders",
          url: "/pos/orders",
          allowedRoles: ["ADMIN", "MANAGER", "STAFF"],
        },
        {
          title: "Tables",
          url: "/pos/tables",
          allowedRoles: ["ADMIN", "MANAGER", "STAFF"],
        },
        {
          title: "Waitlist",
          url: "/pos/waitlist",
          allowedRoles: ["ADMIN", "MANAGER", "STAFF"],
        },
        {
          title: "New Order",
          url: "/pos/new-order",
          allowedRoles: ["ADMIN", "MANAGER", "STAFF"],
        },
      ],
    },
    {
      title: "Kitchen & Orders",
      url: "/kitchen",
      icon: ChefHat,
      allowedRoles: ["ADMIN", "MANAGER", "KITCHEN", "STAFF"],
      items: [
        {
          title: "Kitchen Display",
          url: "/kitchen",
          allowedRoles: ["ADMIN", "MANAGER", "KITCHEN", "STAFF"],
        },
        {
          title: "Order History",
          url: "/orders/history",
          allowedRoles: ["ADMIN", "MANAGER", "STAFF"],
        },
      ],
    },
  ],
};

// Helper function to find a route configuration by URL
export function getRouteConfig(
  path: string,
  items: NavItemType[],
): NavItemType | null {
  for (const item of items) {
    if (item.url === path) return item;
    if (item.items) {
      const found = item.items.find((sub) => sub.url === path);
      if (found)
        return {
          ...found,
          allowedRoles: found.allowedRoles || item.allowedRoles,
        } as NavItemType;
    }
  }
  return null;
}

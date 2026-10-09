import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  layout("routes/auth/layout.tsx", [
    route("signin", "routes/auth/SignInPage.tsx"),
    route("signup", "routes/auth/SignUpPage.tsx"),
  ]),
  // Public: a walk-in has no account, so this sits outside the customer
  // layout and its session check.
  route("/waitlist", "routes/JoinWaitlistPage.tsx"),
  layout("routes/customer/layout.tsx", [
    route("/checkout/success", "routes/customer/Success.tsx"),
    route("/checkout/cancelled", "routes/customer/Cancelled.tsx"),
    route("/reservation", "routes/customer/Reservation.tsx"),
    route("/profile/:id", "routes/customer/Profile.tsx"),
  ]),
  layout("routes/protected/layout.tsx", [
    // admin
    route("/dashboard", "routes/protected/admin/Dashboard.tsx"),
    route(
      "/admin/menu/items-categories/:id",
      "routes/protected/admin/Categories&CreateItem.tsx",
    ),
    route("/admin/menu", "routes/protected/admin/AllItems.tsx"),
    route("/admin/users", "routes/protected/admin/Users.tsx"),
    route("/admin/notifications", "routes/protected/admin/Notifications.tsx"),
    route("/admin/reservations", "routes/protected/pos/ReservationsPage.tsx"),
    route("/admin/activities-log", "routes/protected/admin/ActivitiesLogs.tsx"),
    route("/admin/inventory", "routes/protected/admin/Inventory.tsx"),
    // reports
    route("/reports/day-close", "routes/protected/admin/DayClose.tsx"),
    // pos
    route("/pos/tables", "routes/protected/pos/Tables.tsx"),
    route("/pos/new-order", "routes/protected/pos/new-order.tsx"),
    route("/pos/orders", "routes/protected/pos/ActiveOrders.tsx"),
    route("/pos/waitlist", "routes/protected/pos/Waitlist.tsx"),
    route("/orders/history", "routes/protected/pos/OrderHistory.tsx"),
    // kitchen
    route("/kitchen", "routes/protected/kitchen/Kitchen.tsx"),
  ]),
] satisfies RouteConfig;

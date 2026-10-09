/**
 * SSR smoke test for the PRO frontend components.
 *
 *   cd frontend && npm run verify:components
 *
 * Renders the operational screens and the PRO panels to static HTML with the
 * query cache pre-filled, proving they render real data — not merely that they
 * compile. No browser required.
 *
 * Note: this uses `scripts/vite.probe.config.ts` because the app's own
 * `resolve.tsconfigPaths` alias is not honoured by vite-node's bundled Vite.
 */
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AiBriefing from "@/components/dashboard/AiBriefing";
import NotificationsPage from "@/routes/protected/admin/Notifications";
import KitchenBoard from "@/components/kitchen/KitchenBoard";
import ActiveOrders from "@/components/pos/ActiveOrders";
import DayClose from "@/components/reports/DayClose";
import { Receipt } from "@/components/receipt/Receipt";
import { elapsedMinutes, formatElapsed, ticketCode, urgencyOf } from "@/lib/time";
import { qk } from "@/lib/query-keys";
import { posCart } from "@/store";
import type { itemsProps } from "@/type";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

/* ---------------- fixture: shape matches backend GET /api/briefings/latest --- */
const briefing = {
  id: "b1",
  kind: "FORECAST" as const,
  headline: "Next 7 days projected at $1,842.50",
  summary:
    "Revenue is trending up 12% week-over-week. Friday and Saturday carry the load.",
  model: "gemini-3-flash-preview",
  periodStart: new Date().toISOString(),
  periodEnd: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  payload: {
    kind: "FORECAST" as const,
    generatedBy: "gemini" as const,
    highlights: [
      { label: "Revenue (7d)", value: "$553.00", delta: 100 },
      { label: "Orders (7d)", value: "14", delta: 100 },
      { label: "Avg order value", value: "$39.50", delta: 8 },
      { label: "Table occupancy", value: "67%", delta: null },
    ],
    insights: [
      '"Chicken Biryani" is the top earner at $115.50 from 9 covers.',
      "Main Course drives 62% of category revenue.",
      "Peak trading hour is 19:00 with 5 orders.",
    ],
    risks: ["3 items are unavailable and may be suppressing sales."],
    actions: [
      { title: "Restock unavailable items", detail: "Re-enable the flagged dishes.", priority: "HIGH" as const },
      { title: "Promote the top performer", detail: "Bundle the hero dish.", priority: "MEDIUM" as const },
      { title: "Staff the peak window", detail: "Roster around 19:00.", priority: "LOW" as const },
    ],
    forecast: {
      totalPredicted: 1842.5,
      dampedTrend: 1.12,
      points: [
        { date: "2026-10-01", weekday: "Thu", predictedRevenue: 210.5, predictedOrders: 5, confidence: 88, lower: 180, upper: 240, basis: "weekday-seasonal" },
        { date: "2026-10-02", weekday: "Fri", predictedRevenue: 320.0, predictedOrders: 8, confidence: 83, lower: 280, upper: 360, basis: "weekday-seasonal" },
        { date: "2026-10-03", weekday: "Sat", predictedRevenue: 355.25, predictedOrders: 9, confidence: 78, lower: 300, upper: 410, basis: "weekday-seasonal" },
        { date: "2026-10-04", weekday: "Sun", predictedRevenue: 240.0, predictedOrders: 6, confidence: 73, lower: 200, upper: 280, basis: "weekday-seasonal" },
        { date: "2026-10-05", weekday: "Mon", predictedRevenue: 150.0, predictedOrders: 4, confidence: 68, lower: 120, upper: 180, basis: "weekday-seasonal" },
        { date: "2026-10-06", weekday: "Tue", predictedRevenue: 172.81, predictedOrders: 4, confidence: 63, lower: 140, upper: 205, basis: "weekday-seasonal" },
        { date: "2026-10-07", weekday: "Wed", predictedRevenue: 193.94, predictedOrders: 5, confidence: 58, lower: 155, upper: 232, basis: "weekday-seasonal" },
      ],
      busiest: { date: "2026-10-03", weekday: "Sat", predictedRevenue: 355.25, predictedOrders: 9, confidence: 78, lower: 300, upper: 410, basis: "weekday-seasonal" },
      quietest: { date: "2026-10-05", weekday: "Mon", predictedRevenue: 150, predictedOrders: 4, confidence: 68, lower: 120, upper: 180, basis: "weekday-seasonal" },
    },
  },
};

const exec = {
  ...briefing,
  id: "b0",
  kind: "EXECUTIVE" as const,
  headline: "Revenue up 100% to $553.00",
  payload: { ...briefing.payload, kind: "EXECUTIVE" as const, forecast: undefined },
};

const log = {
  data: [
    { id: "l1", channel: "EMAIL" as const, status: "SENT" as const, template: "welcome", recipient: "guest@example.com", subject: "Welcome", error: null, createdAt: new Date().toISOString() },
    { id: "l2", channel: "PUSH" as const, status: "SKIPPED" as const, template: "push-test", recipient: "user-1", subject: "Test", error: "no subscriptions", createdAt: new Date().toISOString() },
  ],
  totals: { emailSent: 12, pushSent: 3, failed: 1 },
};

function render(node: React.ReactElement, seed: (qc: QueryClient) => void) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  seed(qc);
  const html = renderToString(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  );
  // React inserts `<!-- -->` between adjacent text nodes to preserve hydration
  // boundaries, so "$" and "12.50" arrive as separate nodes. Strip the markers
  // so assertions can match what a user actually sees.
  return html.replace(/<!--[^>]*-->/g, "");
}

/* ---------------- AiBriefing ---------------- */
const aiHtml = render(<AiBriefing />, (qc) => {
  qc.setQueryData(["briefings", "latest"], { data: { executive: exec, forecast: briefing } });
});
check("AiBriefing renders", aiHtml.length > 500, `${aiHtml.length} bytes`);
check("AiBriefing shows the PRO badge", aiHtml.includes("Pro"));
check("AiBriefing shows the Executive headline by default", aiHtml.includes("Revenue up 100% to $553.00"));
check("AiBriefing renders KPI highlight tiles", aiHtml.includes("Revenue (7d)") && aiHtml.includes("$553.00"));
check("AiBriefing renders insights", aiHtml.includes("Chicken Biryani"));
check("AiBriefing renders risks", aiHtml.includes("unavailable"));
check("AiBriefing renders recommended actions", aiHtml.includes("Restock unavailable items"));
check("AiBriefing renders action priorities", aiHtml.includes("HIGH") && aiHtml.includes("MEDIUM") && aiHtml.includes("LOW"));

/* ---------------- Notifications page ---------------- */
const notifHtml = render(<NotificationsPage />, (qc) => {
  // Seeded via the key factory, not the literal, so this test cannot silently
  // stop matching if the key's value ever changes.
  qc.setQueryData(qk.notificationLog, log);
});
check("Notifications page renders", notifHtml.length > 500, `${notifHtml.length} bytes`);
check("Notifications page shows the heading", notifHtml.includes("Notifications"));
check("Notifications page lists email templates", notifHtml.includes("Reservation confirmation"));
check("Notifications page renders the delivery log", notifHtml.includes("Delivery log"));
check("Notifications page renders log rows", notifHtml.includes("welcome") && notifHtml.includes("SENT"));
check("Notifications page shows totals", notifHtml.includes("12 email(s) delivered"));
check("Notifications page mentions the outbox fallback", notifHtml.includes(".mail-outbox"));

/* ---------------- time helpers (used by every live badge) ---------------- */
check("formatElapsed renders minutes", formatElapsed(7) === "7m");
check("formatElapsed rolls over to hours", formatElapsed(72) === "1h 12m");
check("urgencyOf bands normal", urgencyOf(3) === "normal");
check("urgencyOf bands warn", urgencyOf(6) === "warn");
check("urgencyOf bands late", urgencyOf(11) === "late");
check("ticketCode takes the last six characters", ticketCode("6abc15c65bd1c7d3866129aa") === "6129AA");
check(
  "elapsedMinutes never goes negative",
  elapsedMinutes(new Date(Date.now() + 60_000).toISOString(), Date.now()) === 0,
);

/* ---------------- live order fixtures ---------------- */
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const liveOrders = [
  {
    id: "6abc15c65bd1c7d3866129aa",
    orderType: "DINE_IN" as const,
    status: "PENDING" as const,
    createdAt: minutesAgo(12),
    table: { id: "t1", name: "05" },
    items: [
      {
        id: "i1",
        quantity: 2,
        notes: "No onions",
        menuItem: { id: "m1", name: "Chicken Biryani" },
      },
    ],
  },
  {
    id: "6abc15c65bd1c7d3866129bb",
    orderType: "TAKEAWAY" as const,
    status: "PREPARING" as const,
    createdAt: minutesAgo(4),
    table: null,
    items: [
      {
        id: "i2",
        quantity: 1,
        notes: null,
        menuItem: { id: "m2", name: "Mango Lassi" },
      },
    ],
  },
  {
    id: "6abc15c65bd1c7d3866129cc",
    orderType: "DINE_IN" as const,
    status: "READY" as const,
    createdAt: minutesAgo(2),
    table: { id: "t2", name: "VIP 1" },
    items: [
      {
        id: "i3",
        quantity: 3,
        notes: null,
        menuItem: { id: "m3", name: "Crispy Spring Rolls" },
      },
    ],
  },
];

const boardPayload = { data: liveOrders, serverTime: new Date().toISOString() };

/* ---------------- Kitchen Display ---------------- */
const kitchenHtml = render(<KitchenBoard />, (qc) => {
  qc.setQueryData(["orders", "active"], boardPayload);
});
check("Kitchen board renders", kitchenHtml.length > 500, `${kitchenHtml.length} bytes`);
check(
  "Kitchen board renders all three columns",
  kitchenHtml.includes("New") &&
    kitchenHtml.includes("On the line") &&
    kitchenHtml.includes("At the pass"),
);
check(
  "Kitchen board shows the speakable ticket code",
  kitchenHtml.includes("6129AA"),
);
check(
  "Kitchen board shows the table destination",
  kitchenHtml.includes("Table 05"),
);
check(
  "Kitchen board shows takeaway orders too",
  kitchenHtml.includes("Takeaway"),
);
check("Kitchen board renders item names", kitchenHtml.includes("Chicken Biryani"));
check("Kitchen board renders quantities", kitchenHtml.includes(">2<"));
check("Kitchen board surfaces item notes", kitchenHtml.includes("No onions"));
check("Kitchen board shows elapsed time", kitchenHtml.includes("12m"));
check(
  "Kitchen board offers one-tap actions",
  kitchenHtml.includes("Start cooking") &&
    kitchenHtml.includes("Mark ready") &&
    kitchenHtml.includes("Mark served"),
);

/* ---------------- POS Active Orders ---------------- */
const posOrders = liveOrders.map((o, i) => ({
  ...o,
  totalAmount: 12.5 + i,
  paymentStatus: i === 0 ? ("PENDING" as const) : ("PAID" as const),
  paymentMethod: "CASH" as const,
}));

const posHtml = render(<ActiveOrders />, (qc) => {
  qc.setQueryData(["orders", "active", "pos"], {
    data: posOrders,
    serverTime: new Date().toISOString(),
  });
});
check("Active Orders board renders", posHtml.length > 500, `${posHtml.length} bytes`);
check("Active Orders shows the heading", posHtml.includes("Active Orders"));
check("Active Orders shows order values", posHtml.includes("$12.50"));
check("Active Orders flags unpaid orders", posHtml.includes("Unpaid"));
check("Active Orders shows the unpaid total", posHtml.includes("unpaid"));
check("Active Orders offers take payment", posHtml.includes("Take payment"));
check("Active Orders shows status filters", posHtml.includes("Preparing"));
check("Active Orders shows payment method once paid", posHtml.includes("Paid"));
check("Active Orders offers a reprint action", posHtml.includes("Reprint receipt"));

/* ---------------- Receipt (printable chit) ---------------- */
const receiptHtml = render(
  <Receipt
    data={{
      orderId: "6abc15c65bd1c7d3866129aa",
      createdAt: "2026-09-30T12:00:00.000Z",
      orderType: "DINE_IN",
      tableName: "05",
      paymentMethod: "CASH",
      total: 27.5,
      lines: [
        { name: "Chicken Biryani", quantity: 2, unitPrice: 11.25, notes: "No onions" },
        { name: "Mango Lassi", quantity: 1, unitPrice: 5, notes: null },
      ],
    }}
  />,
  () => {},
);
check("Receipt renders", receiptHtml.length > 400, `${receiptHtml.length} bytes`);
check("Receipt shows the order code", receiptHtml.includes("6129AA"));
check("Receipt shows the table", receiptHtml.includes("05"));
check("Receipt prints item lines", receiptHtml.includes("Chicken Biryani") && receiptHtml.includes("Mango Lassi"));
check("Receipt prints the kitchen note", receiptHtml.includes("No onions"));
check("Receipt prints line totals", receiptHtml.includes("$22.50"));
check("Receipt prints the order total", receiptHtml.includes("$27.50"));
check("Receipt prints the payment method", receiptHtml.includes("CASH"));

/* ---------------- Cart lines (notes must not merge) ---------------- */
const dish: itemsProps = {
  id: "m1",
  name: "Chicken Biryani",
  price: 11.25,
  categoryId: "c1",
  isAvailable: true,
  category: { id: "c1", name: "Main Course" },
  discount: 0,
};

posCart.actions.reset();
posCart.actions.addItem(dish);
posCart.actions.addItem(dish);
check(
  "Cart merges repeat taps of the same plain dish",
  posCart.state.items.length === 1 && posCart.state.items[0].quantity === 2,
  `${posCart.state.items.length} line(s), qty ${posCart.state.items[0]?.quantity}`,
);

const firstLine = posCart.state.items[0].lineId;
posCart.actions.setItemNotes(firstLine, "No onions");
posCart.actions.addItem(dish);
check(
  "Cart splits a noted dish onto its own line",
  posCart.state.items.length === 2,
  `${posCart.state.items.length} line(s)`,
);
check(
  "The noted line keeps its instruction",
  posCart.state.items[0].notes === "No onions" &&
    !posCart.state.items[1].notes,
);
check(
  "Cart total counts both lines",
  posCart.state.total === 33.75,
  `$${posCart.state.total.toFixed(2)}`,
);

posCart.actions.updateQuantity(firstLine, 1);
check(
  "Quantity edits address one line only",
  posCart.state.items[0].quantity === 3 &&
    posCart.state.items[1].quantity === 1,
  `qty ${posCart.state.items[0].quantity} / ${posCart.state.items[1].quantity}`,
);

posCart.actions.removeItem(firstLine);
check(
  "Removing a line leaves the others alone",
  posCart.state.items.length === 1 &&
    posCart.state.items[0].notes === "",
);
check("Cart total follows the removal", posCart.state.total === 11.25);

posCart.actions.updateQuantity(posCart.state.items[0].lineId, -1);
check(
  "Dropping a line to zero removes it",
  posCart.state.items.length === 0 && posCart.state.total === 0,
);
posCart.actions.reset();

/* ---------------- Day Close (Z report) ---------------- */
const dayCloseReport = {
  businessDate: "2026-09-30",
  window: { start: "2026-09-30T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z" },
  revenue: { gross: 553, collected: 540.5, outstanding: 12.5, voided: 22 },
  orders: {
    total: 14,
    paid: 12,
    open: 2,
    cancelled: 1,
    averageTicket: 45.04,
    byType: [
      { type: "DINE_IN" as const, count: 9, revenue: 380 },
      { type: "TAKEAWAY" as const, count: 5, revenue: 173 },
    ],
    byStatus: [
      { status: "SERVED" as const, count: 11 },
      { status: "PREPARING" as const, count: 2 },
      { status: "CANCELLED" as const, count: 1 },
    ],
  },
  payments: [
    { method: "CASH" as const, count: 7, amount: 300.5 },
    { method: "CARD" as const, count: 5, amount: 240 },
  ],
  hourly: [
    { hour: 12, orders: 4, revenue: 120 },
    { hour: 19, orders: 7, revenue: 320 },
  ],
  items: [
    { name: "Chicken Biryani", quantity: 9, revenue: 115.5 },
    { name: "Mango Lassi", quantity: 12, revenue: 60 },
  ],
  voids: [
    {
      id: "6abc15c65bd1c7d3866129ff",
      orderType: "DINE_IN" as const,
      totalAmount: 22,
      createdAt: "2026-09-30T14:30:00.000Z",
      tableName: "VIP 1",
    },
  ],
  tables: {
    total: 12,
    seats: 40,
    available: 8,
    occupied: 2,
    reserved: 1,
    cleaning: 1,
    occupancyPct: 17,
  },
  reservations: {
    total: 6,
    guests: 18,
    pending: 1,
    confirmed: 3,
    cancelled: 1,
    completed: 1,
  },
  blockers: ["2 orders still open in the kitchen", "2 tables still occupied"],
  closed: false,
};

const dayCloseKey = qk.reports.dayClose(new Date().toISOString().slice(0, 10));
const dayCloseHtml = render(<DayClose />, (qc) => {
  qc.setQueryData(dayCloseKey, {
    data: dayCloseReport,
    serverTime: new Date().toISOString(),
  });
});
check("Day Close renders", dayCloseHtml.length > 1000, `${dayCloseHtml.length} bytes`);
check("Day Close shows the heading", dayCloseHtml.includes("Day Close"));
check("Day Close labels the UTC service day", dayCloseHtml.includes("UTC service day"));
check("Day Close reports collected takings", dayCloseHtml.includes("$540.50"));
check("Day Close reports outstanding money", dayCloseHtml.includes("$12.50"));
check("Day Close reports voids", dayCloseHtml.includes("$22.00"));
check("Day Close computes the average ticket", dayCloseHtml.includes("$45.04"));
check(
  "Day Close lists what is blocking the close",
  dayCloseHtml.includes("2 orders still open in the kitchen") &&
    dayCloseHtml.includes("2 tables still occupied"),
);
check("Day Close splits payments by method", dayCloseHtml.includes("cash") && dayCloseHtml.includes("card"));
check("Day Close shows the order mix", dayCloseHtml.includes("dine in"));
check("Day Close shows the peak hour", dayCloseHtml.includes("7pm"));
check("Day Close ranks top sellers", dayCloseHtml.includes("Chicken Biryani"));
check("Day Close lists the voids with a table", dayCloseHtml.includes("VIP 1"));
check("Day Close offers a printable Z report", dayCloseHtml.includes("Print Z report"));
check(
  "Day Close does not claim the day is clear when it is not",
  !dayCloseHtml.includes("Clear to close"),
);

const clearHtml = render(<DayClose />, (qc) => {
  qc.setQueryData(dayCloseKey, {
    data: {
      ...dayCloseReport,
      blockers: [],
      closed: true,
      orders: { ...dayCloseReport.orders, open: 0 },
      tables: { ...dayCloseReport.tables, occupied: 0, cleaning: 0 },
    },
    serverTime: new Date().toISOString(),
  });
});
check("Day Close confirms a clear day", clearHtml.includes("Clear to close"));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);

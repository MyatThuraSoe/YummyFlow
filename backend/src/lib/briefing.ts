import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "./prisma";

/**
 * AI Briefings engine (PRO).
 *
 * Two kinds:
 *  - EXECUTIVE : "what just happened" — revenue/ops digest with risks + actions.
 *  - FORECAST  : "what is about to happen" — next-7-day demand projection.
 *
 * Design rule: **the deterministic layer is the source of truth for numbers.**
 * Gemini is only ever allowed to add narrative on top of figures we computed
 * ourselves, and if the model is unavailable (no API key, quota, outage) we
 * still return a complete, useful briefing. The dashboard must never break
 * because an LLM was unreachable.
 */

const MODEL = "gemini-3-flash-preview";
const WINDOW_DAYS = 7;
const HISTORY_DAYS = 28; // used for weekday seasonality in forecasts

export type BriefingKindValue = "EXECUTIVE" | "FORECAST";

export type Metrics = Awaited<ReturnType<typeof collectMetrics>>;

const round2 = (n: number) => Math.round(n * 100) / 100;

const trend = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};

/**
 * Midnight UTC of the calendar day containing `d`.
 *
 * Was `setHours(0, 0, 0, 0)` — LOCAL midnight — but every consumer of the result
 * serialises it with `toISOString()`, which is UTC. On a server east of UTC
 * (the deployment target is UTC+3) local midnight is the previous UTC day, so
 * every `dailySeries[].date` label was one day early, and `forecastDemand`
 * inherited a rotated weekday from the shifted label. The two helpers now agree
 * on one timezone, matching `lib/bson.ts`.
 */
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

/* ------------------------------------------------------------------ */
/* 1. Metric collection — pure Prisma, no AI                           */
/* ------------------------------------------------------------------ */

export async function collectMetrics(now = new Date()) {
  const periodEnd = new Date(now);
  const periodStart = new Date(now);
  periodStart.setDate(periodStart.getDate() - WINDOW_DAYS);

  const prevStart = new Date(now);
  prevStart.setDate(prevStart.getDate() - WINDOW_DAYS * 2);

  const historyStart = startOfDay(
    new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000),
  );

  const [currentOrders, previousOrders, historyOrders, reservations, tables, menuItems] =
    await Promise.all([
      prisma.order.findMany({
        where: {
          createdAt: { gte: periodStart, lt: periodEnd },
          status: { not: "CANCELLED" },
        },
        include: { items: { include: { menuItem: { include: { category: true } } } } },
      }),
      prisma.order.findMany({
        where: {
          createdAt: { gte: prevStart, lt: periodStart },
          status: { not: "CANCELLED" },
        },
        include: { items: true },
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: historyStart }, status: { not: "CANCELLED" } },
        include: { items: { include: { menuItem: true } } },
      }),
      // Bounded on BOTH ends. This used to be `{ date: { gte: periodStart } }`,
      // which had no upper bound and therefore returned the entire future
      // booking book — so "reservations in the last 7 days" was really
      // "every reservation ever made, plus everything booked for next month".
      prisma.reservation.findMany({
        where: { date: { gte: periodStart, lt: periodEnd } },
      }),
      prisma.table.findMany({ select: { id: true, status: true, seats: true } }),
      prisma.menuItem.findMany({
        select: {
          id: true,
          name: true,
          price: true,
          isAvailable: true,
          feedbacks: { select: { rating: true } },
        },
      }),
    ]);

  /* --- headline numbers ------------------------------------------- */
  const paidCurrent = currentOrders.filter((o) => o.paymentStatus === "PAID");
  const paidPrevious = previousOrders.filter((o) => o.paymentStatus === "PAID");

  const revenueCurrent = paidCurrent.reduce((s, o) => s + o.totalAmount, 0);
  const revenuePrevious = paidPrevious.reduce((s, o) => s + o.totalAmount, 0);

  const aovCurrent = paidCurrent.length ? revenueCurrent / paidCurrent.length : 0;
  const aovPrevious = paidPrevious.length ? revenuePrevious / paidPrevious.length : 0;

  /* --- order mix --------------------------------------------------- */
  // Iterates `paidCurrent`, not `currentOrders`: this breakdown is compared
  // against `revenueCurrent` (paid only), so counting unpaid orders here made
  // the mix percentages disagree with the headline revenue beside them.
  const mixMap = new Map<string, { count: number; revenue: number }>();
  paidCurrent.forEach((o) => {
    const entry = mixMap.get(o.orderType) ?? { count: 0, revenue: 0 };
    entry.count += 1;
    entry.revenue += o.totalAmount;
    mixMap.set(o.orderType, entry);
  });
  const orderMix = [...mixMap.entries()]
    .map(([type, v]) => ({ type, count: v.count, revenue: round2(v.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  /* --- item / category performance --------------------------------- */
  const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
  const catMap = new Map<string, number>();

  // Paid orders only, for the same reason as the mix above. The category share
  // insight divides this total by `revenue.current` (paid only) — mixing an
  // all-orders numerator into a paid-only denominator is how you get a briefing
  // that cheerfully reports a category "driving 137% of revenue".
  paidCurrent.forEach((o) =>
    o.items.forEach((it: any) => {
      const name = it.menuItem?.id ?? it.menuItem?.name ?? "Unknown";
      const entry = itemMap.get(name) ?? { name, qty: 0, revenue: 0 };
      entry.qty += it.quantity;
      entry.revenue += it.price * it.quantity;
      itemMap.set(name, entry);

      const cat = it.menuItem?.category?.name ?? "Uncategorised";
      catMap.set(cat, (catMap.get(cat) ?? 0) + it.price * it.quantity);
    }),
  );

  const itemsSorted = [...itemMap.values()].sort((a, b) => b.revenue - a.revenue);
  const topItems = itemsSorted
    .slice(0, 5)
    .map((i) => ({ ...i, revenue: round2(i.revenue) }));
  const categoryRevenue = [...catMap.entries()]
    .map(([name, revenue]) => ({ name, revenue: round2(revenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  /* --- temporal patterns ------------------------------------------- */
  // UTC, not local time. `getHours()` and `toLocaleDateString()` bucketed by
  // the HOST's timezone while every other analytics surface in this app buckets
  // in UTC (`analytics.ts`, `dashboard.ts`, `reports.ts` all use `$hour` /
  // `$dateToString` with no timezone, which is UTC). On a UTC+3 server the
  // briefing's "peak trading hour" was three hours off the heatmap a manager
  // sees on the very same dashboard — and the staffing recommendation built on
  // it was wrong.
  const hourMap = new Array(24).fill(0) as number[];
  const weekdayMap = new Map<string, number>();
  paidCurrent.forEach((o) => {
    // `noUncheckedIndexedAccess` is on, so the indexed write needs a guard.
    const hour = o.createdAt.getUTCHours();
    hourMap[hour] = (hourMap[hour] ?? 0) + 1;
    weekdayMap.set(
      o.createdAt.toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      }),
      (weekdayMap.get(
        o.createdAt.toLocaleDateString("en-US", {
          weekday: "short",
          timeZone: "UTC",
        }),
      ) ?? 0) + o.totalAmount,
    );
  });
  const peakHours = hourMap
    .map((orders, hour) => ({ hour, orders }))
    .filter((h) => h.orders > 0)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 3);

  /* --- reservations + floor ---------------------------------------- */
  const reservationSummary = {
    total: reservations.length,
    pending: reservations.filter((r) => r.status === "PENDING").length,
    confirmed: reservations.filter((r) => r.status === "CONFIRMED").length,
    cancelled: reservations.filter((r) => r.status === "CANCELLED").length,
    guests: reservations
      .filter((r) => r.status !== "CANCELLED")
      .reduce((s, r) => s + r.guests, 0),
  };

  const tableSummary = {
    total: tables.length,
    available: tables.filter((t) => t.status === "AVAILABLE").length,
    occupied: tables.filter((t) => t.status === "OCCUPIED").length,
    reserved: tables.filter((t) => t.status === "RESERVED").length,
    // Turned over but not yet reset. A high number here means the floor is
    // waiting on bussing, which is a different problem from being full.
    cleaning: tables.filter((t) => t.status === "CLEANING").length,
    seats: tables.reduce((s, t) => s + t.seats, 0),
    occupancyPct: tables.length
      ? Math.round(
          ((tables.filter((t) => t.status !== "AVAILABLE").length / tables.length) * 100),
        )
      : 0,
  };

  /* --- menu health -------------------------------------------------- */
  const rated = menuItems
    .map((m) => ({
      name: m.name,
      avg: m.feedbacks.length
        ? m.feedbacks.reduce((s, f) => s + f.rating, 0) / m.feedbacks.length
        : null,
      count: m.feedbacks.length,
    }))
    .filter((m) => m.avg !== null) as { name: string; avg: number; count: number }[];

  const unavailableItems = menuItems.filter((m) => !m.isAvailable);

  const menuHealth = {
    total: menuItems.length,
    /**
     * The real count, counted BEFORE the list is truncated.
     *
     * The briefing previously reported `outOfStock.length` — the length of an
     * array that had already been `.slice(0, 8)` — so a restaurant with 20
     * unavailable dishes was told "8 item(s) are unavailable", and the
     * `> 2` priority threshold below could never see a number above 8.
     */
    outOfStockTotal: unavailableItems.length,
    outOfStock: unavailableItems.map((m) => m.name).slice(0, 8),
    avgRating: rated.length
      ? round2(rated.reduce((s, m) => s + m.avg, 0) / rated.length)
      : null,
    lowRated: rated
      .filter((m) => m.avg <= 3.5)
      .sort((a, b) => a.avg - b.avg)
      .slice(0, 5)
      .map((m) => ({ name: m.name, rating: round2(m.avg), reviews: m.count })),
  };

  /* --- daily series over the history window ------------------------ */
  const seriesMap = new Map<string, { revenue: number; orders: number }>();
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = startOfDay(new Date(now.getTime() - i * 24 * 60 * 60 * 1000));
    seriesMap.set(d.toISOString().slice(0, 10), { revenue: 0, orders: 0 });
  }
  historyOrders.forEach((o) => {
    const key = startOfDay(new Date(o.createdAt)).toISOString().slice(0, 10);
    const entry = seriesMap.get(key);
    if (!entry) return;
    entry.orders += 1;
    if (o.paymentStatus === "PAID") entry.revenue += o.totalAmount;
  });
  const dailySeries = [...seriesMap.entries()].map(([date, v]) => ({
    date,
    revenue: round2(v.revenue),
    orders: v.orders,
  }));

  return {
    periodStart,
    periodEnd,
    windowDays: WINDOW_DAYS,
    revenue: {
      current: round2(revenueCurrent),
      previous: round2(revenuePrevious),
      trend: trend(revenueCurrent, revenuePrevious),
    },
    orders: {
      current: currentOrders.length,
      previous: previousOrders.length,
      trend: trend(currentOrders.length, previousOrders.length),
    },
    aov: {
      current: round2(aovCurrent),
      previous: round2(aovPrevious),
      trend: trend(aovCurrent, aovPrevious),
    },
    orderMix,
    topItems,
    categoryRevenue,
    peakHours,
    weekdayRevenue: [...weekdayMap.entries()].map(([day, revenue]) => ({
      day,
      revenue: round2(revenue),
    })),
    reservations: reservationSummary,
    tables: tableSummary,
    menuHealth,
    dailySeries,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Deterministic forecast — weekday seasonality + damped trend      */
/* ------------------------------------------------------------------ */

export function forecastDemand(metrics: Metrics, now = new Date()) {
  const byWeekday = new Map<number, number[]>();
  metrics.dailySeries.forEach((d) => {
    const wd = new Date(`${d.date}T00:00:00`).getDay();
    if (!byWeekday.has(wd)) byWeekday.set(wd, []);
    byWeekday.get(wd)!.push(d.revenue);
  });

  const weekdayAvg = new Map<number, number>();
  byWeekday.forEach((values, wd) => {
    weekdayAvg.set(wd, values.reduce((s, v) => s + v, 0) / values.length);
  });

  // Damped trend: never extrapolate more than ±25% away from the seasonal base.
  const overallAvg =
    metrics.dailySeries.reduce((s, d) => s + d.revenue, 0) /
    Math.max(metrics.dailySeries.length, 1);
  const recent = metrics.dailySeries.slice(-7);
  const recentAvg = recent.length
    ? recent.reduce((s, d) => s + d.revenue, 0) / recent.length
    : 0;
  const rawTrend = overallAvg > 0 ? recentAvg / overallAvg : 1;
  const dampedTrend = Math.min(Math.max(rawTrend, 0.75), 1.25);

  const points = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const wd = d.getDay();
    const base = weekdayAvg.get(wd) ?? overallAvg;
    const predictedRevenue = round2(base * dampedTrend);

    // Confidence falls off with horizon; widen the band accordingly.
    const confidence = Math.max(45, 88 - (i - 1) * 5);
    const spread = predictedRevenue * (0.12 + (i - 1) * 0.025);

    points.push({
      date: d.toISOString().slice(0, 10),
      weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
      predictedRevenue,
      predictedOrders: Math.max(0, Math.round(predictedRevenue / Math.max(metrics.aov.current, 1))),
      confidence,
      lower: round2(Math.max(0, predictedRevenue - spread)),
      upper: round2(predictedRevenue + spread),
      basis: weekdayAvg.has(wd) ? "weekday-seasonal" : "average",
    });
  }

  const totalPredicted = round2(points.reduce((s, p) => s + p.predictedRevenue, 0));
  const busiest = [...points].sort((a, b) => b.predictedRevenue - a.predictedRevenue)[0];
  const quietest = [...points].sort((a, b) => a.predictedRevenue - b.predictedRevenue)[0];

  return { points, totalPredicted, busiest, quietest, dampedTrend: round2(dampedTrend) };
}

/* ------------------------------------------------------------------ */
/* 3. Heuristic narrative (always available)                           */
/* ------------------------------------------------------------------ */

function heuristicBriefing(metrics: Metrics, kind: BriefingKindValue) {
  const dir = metrics.revenue.trend >= 0 ? "up" : "down";
  const absTrend = Math.abs(metrics.revenue.trend);

  const headline =
    kind === "EXECUTIVE"
      ? `Revenue ${dir} ${absTrend}% to $${metrics.revenue.current.toFixed(2)}`
      : `Next 7 days projected at $${forecastDemand(metrics).totalPredicted.toFixed(2)}`;

  const highlights = [
    {
      label: "Revenue (7d)",
      value: `$${metrics.revenue.current.toFixed(2)}`,
      delta: metrics.revenue.trend,
    },
    {
      label: "Orders (7d)",
      value: `${metrics.orders.current}`,
      delta: metrics.orders.trend,
    },
    {
      label: "Avg order value",
      value: `$${metrics.aov.current.toFixed(2)}`,
      delta: metrics.aov.trend,
    },
    {
      label: "Table occupancy",
      value: `${metrics.tables.occupancyPct}%`,
      delta: null,
    },
  ];

  const insights: string[] = [];
  if (metrics.topItems[0]) {
    insights.push(
      `"${metrics.topItems[0].name}" is the top earner at $${metrics.topItems[0].revenue.toFixed(2)} from ${metrics.topItems[0].qty} covers.`,
    );
  }
  if (metrics.categoryRevenue[0]) {
    const share = metrics.revenue.current
      ? Math.round((metrics.categoryRevenue[0].revenue / metrics.revenue.current) * 100)
      : 0;
    insights.push(
      `${metrics.categoryRevenue[0].name} drives ${share}% of category revenue.`,
    );
  }
  if (metrics.peakHours[0]) {
    insights.push(
      `Peak trading hour is ${String(metrics.peakHours[0].hour).padStart(2, "0")}:00 with ${metrics.peakHours[0].orders} orders.`,
    );
  }
  if (metrics.reservations.total) {
    insights.push(
      `${metrics.reservations.confirmed} confirmed bookings covering ${metrics.reservations.guests} guests, ${metrics.reservations.pending} still pending.`,
    );
  }

  const risks: string[] = [];
  if (metrics.menuHealth.outOfStockTotal) {
    // The true count, not the truncated list length.
    const named = metrics.menuHealth.outOfStock.slice(0, 3).join(", ");
    risks.push(
      `${metrics.menuHealth.outOfStockTotal} item(s) are unavailable and may be suppressing sales: ${named}${metrics.menuHealth.outOfStockTotal > 3 ? ", …" : ""}.`,
    );
  }
  if (metrics.menuHealth.lowRated.length) {
    risks.push(
      `Low-rated dishes need attention: ${metrics.menuHealth.lowRated.map((m) => `${m.name} (${m.rating}★)`).join(", ")}.`,
    );
  }
  if (metrics.reservations.pending > 2) {
    risks.push(`${metrics.reservations.pending} bookings are unconfirmed — guests may no-show.`);
  }
  if (metrics.revenue.trend < 0) {
    risks.push(`Revenue is down ${absTrend}% week-over-week; investigate traffic sources.`);
  }
  if (!risks.length) risks.push("No material operational risks detected this period.");

  const actions = [
    {
      title: "Restock unavailable items",
      detail: metrics.menuHealth.outOfStockTotal
        ? `Re-enable or replace ${metrics.menuHealth.outOfStockTotal} item(s): ${metrics.menuHealth.outOfStock.slice(0, 4).join(", ")}.`
        : "All items available — keep par levels under review.",
      priority: metrics.menuHealth.outOfStockTotal > 2 ? "HIGH" : "LOW",
    },
    {
      title: "Promote the top performer",
      detail: metrics.topItems[0]
        ? `Feature "${metrics.topItems[0].name}" in a bundle or upsell slot to lift average order value from $${metrics.aov.current.toFixed(2)}.`
        : "Not enough sales history yet to pick a hero item.",
      priority: "MEDIUM",
    },
    {
      title: "Staff the peak window",
      detail: metrics.peakHours[0]
        ? `Roster strongest staff around ${String(metrics.peakHours[0].hour).padStart(2, "0")}:00.`
        : "No peak window identified yet.",
      priority: "MEDIUM",
    },
  ];

  let summary = `Over the last ${metrics.windowDays} days the restaurant took $${metrics.revenue.current.toFixed(2)} across ${metrics.orders.current} orders (AOV $${metrics.aov.current.toFixed(2)}), ${dir} ${absTrend}% versus the prior period. `;
  summary += `Occupancy sits at ${metrics.tables.occupancyPct}% with ${metrics.reservations.guests} guests booked in. `;
  summary += risks[0];

  const payload: Record<string, unknown> = {
    kind,
    highlights,
    insights,
    risks,
    actions,
    generatedBy: "heuristic",
    metrics,
  };

  if (kind === "FORECAST") {
    payload.forecast = forecastDemand(metrics);
  }

  return { headline, summary, payload };
}

/* ------------------------------------------------------------------ */
/* 4. Gemini narrative layer (best-effort)                             */
/* ------------------------------------------------------------------ */

async function geminiBriefing(metrics: Metrics, kind: BriefingKindValue) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.length < 20) return null;

  const forecast = kind === "FORECAST" ? forecastDemand(metrics) : null;

  const prompt = `You are the head of analytics for a restaurant group. Write a ${
    kind === "EXECUTIVE" ? "concise executive briefing on the last 7 days" : "7-day demand forecast briefing"
  }.

STRICT RULES:
- Never invent numbers. Only use the figures supplied below.
- Be specific and operational, not generic. No filler, no "as an AI".
- "$" currency. Keep the summary under 90 words.

VERIFIED METRICS (JSON):
${JSON.stringify(
  {
    revenue: metrics.revenue,
    orders: metrics.orders,
    aov: metrics.aov,
    orderMix: metrics.orderMix,
    topItems: metrics.topItems,
    categoryRevenue: metrics.categoryRevenue,
    peakHours: metrics.peakHours,
    reservations: metrics.reservations,
    tables: metrics.tables,
    menuHealth: metrics.menuHealth,
    forecast: forecast
      ? {
          totalPredicted: forecast.totalPredicted,
          busiest: forecast.busiest,
          quietest: forecast.quietest,
          points: forecast.points,
        }
      : undefined,
  },
  null,
  0,
)}

Respond with STRICTLY this JSON object and nothing else:
{
  "headline": "One punchy line, max 12 words",
  "summary": "<= 90 word narrative",
  "insights": ["3-5 specific observations with numbers"],
  "risks": ["1-3 concrete risks"],
  "actions": [{ "title": "short imperative", "detail": "what to do and why", "priority": "HIGH" | "MEDIUM" | "LOW" }]
}`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: "application/json" },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const parsed = JSON.parse(text);

  if (!parsed?.headline || !parsed?.summary) return null;

  return {
    headline: String(parsed.headline).slice(0, 140),
    summary: String(parsed.summary),
    insights: Array.isArray(parsed.insights) ? parsed.insights.map(String) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
    actions: Array.isArray(parsed.actions)
      ? parsed.actions.map((a: any) => ({
          title: String(a?.title ?? "Action"),
          detail: String(a?.detail ?? ""),
          priority: ["HIGH", "MEDIUM", "LOW"].includes(a?.priority) ? a.priority : "MEDIUM",
        }))
      : [],
  };
}

/* ------------------------------------------------------------------ */
/* 5. Public API                                                       */
/* ------------------------------------------------------------------ */

/**
 * Generate + persist a briefing. Always resolves with a usable record:
 * Gemini failure degrades to the heuristic briefing rather than throwing.
 */
export async function generateBriefing(kind: BriefingKindValue = "EXECUTIVE") {
  const metrics = await collectMetrics();
  const fallback = heuristicBriefing(metrics, kind);

  let narrative: Awaited<ReturnType<typeof geminiBriefing>> = null;
  try {
    narrative = await geminiBriefing(metrics, kind);
  } catch (e: any) {
    console.warn(`[briefing] Gemini unavailable, using heuristic: ${e?.message}`);
  }

  const merged = narrative
    ? {
        headline: narrative.headline,
        summary: narrative.summary,
        insights: narrative.insights.length ? narrative.insights : (fallback.payload.insights as string[]),
        risks: narrative.risks.length ? narrative.risks : (fallback.payload.risks as string[]),
        actions: narrative.actions.length ? narrative.actions : (fallback.payload.actions as any[]),
        generatedBy: "gemini" as const,
      }
    : {
        headline: fallback.headline,
        summary: fallback.summary,
        insights: fallback.payload.insights as string[],
        risks: fallback.payload.risks as string[],
        actions: fallback.payload.actions as any[],
        generatedBy: "heuristic" as const,
      };

  const payload: Record<string, unknown> = {
    kind,
    generatedBy: merged.generatedBy,
    highlights: fallback.payload.highlights,
    insights: merged.insights,
    risks: merged.risks,
    actions: merged.actions,
    metrics,
  };
  if (kind === "FORECAST") payload.forecast = forecastDemand(metrics);

  const saved = await prisma.briefing.create({
    data: {
      kind,
      headline: merged.headline,
      summary: merged.summary,
      payload: payload as any,
      model: merged.generatedBy === "gemini" ? MODEL : "heuristic-engine",
      periodStart: metrics.periodStart,
      periodEnd: metrics.periodEnd,
    },
  });

  return saved;
}

/** Latest briefing of each kind, without generating anything. */
export async function getLatestBriefings() {
  const [executive, forecast] = await Promise.all([
    prisma.briefing.findFirst({ where: { kind: "EXECUTIVE" }, orderBy: { createdAt: "desc" } }),
    prisma.briefing.findFirst({ where: { kind: "FORECAST" }, orderBy: { createdAt: "desc" } }),
  ]);
  return { executive, forecast };
}

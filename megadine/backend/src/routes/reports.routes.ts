import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { activeAlerts, closeBusinessDay, dailySales, dashboard, hourlyReport, itemsReport, salesTrend, stockMovementReport, wastageReport, zReport } from "../services/report.service.js";
import { foodCostPercent } from "../services/inventory.service.js";
import { prisma } from "../lib/prisma.js";
import { fromCents, toCents } from "../lib/money.js";
import { toCsv } from "../lib/csv.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requirePermission("report.view"));

function rangeFromQuery(query: Record<string, string | undefined>) {
  const now = new Date();
  const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = query.to ? new Date(query.to) : from;
  return { from, to };
}

reportsRouter.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const data = await dashboard(req.auth!.restaurantId);
    res.json(data);
  }),
);

reportsRouter.get(
  "/alerts",
  asyncHandler(async (req, res) => {
    res.json(await activeAlerts(req.auth!.restaurantId));
  }),
);

reportsRouter.get(
  "/trend",
  asyncHandler(async (req, res) => {
    const days = Math.min(30, Math.max(2, Number((req.query as { days?: string }).days ?? 7) || 7));
    res.json(await salesTrend(req.auth!.restaurantId, days));
  }),
);

reportsRouter.get(
  "/daily",
  asyncHandler(async (req, res) => {
    const { date } = req.query as { date?: string };
    const businessDate = date ? new Date(date) : new Date();
    const report = await dailySales(req.auth!.restaurantId, businessDate);
    res.json({ report });
  }),
);

reportsRouter.get(
  "/items",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    const rows = await itemsReport(req.auth!.restaurantId, { from, to });
    if (req.query.format === "csv") {
      const csv = toCsv(["Item", "Category", "Qty", "Revenue"], rows.map((r) => [r.name, r.category, r.qty, fromCents(r.revenue)]));
      res.header("Content-Type", "text/csv").attachment("items-report.csv").send(csv);
      return;
    }
    res.json({ rows });
  }),
);

reportsRouter.get(
  "/hourly",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    const rows = await hourlyReport(req.auth!.restaurantId, { from, to });
    res.json({ rows });
  }),
);

reportsRouter.get(
  "/employees",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    const employees = await prisma.user.findMany({
      where: { restaurantId: req.auth!.restaurantId, isActive: true },
      select: { id: true, name: true, role: true },
    });
    const orders = await prisma.order.groupBy({
      by: ["cashierId"],
      where: {
        restaurantId: req.auth!.restaurantId,
        status: "COMPLETED",
        businessDate: { gte: from, lte: to },
      },
      _sum: { total: true },
      _count: true,
    });
    const map = new Map(orders.map((o) => [o.cashierId, o]));
    const rows = employees.map((e) => {
      const o = map.get(e.id);
      return {
        id: e.id,
        name: e.name,
        role: e.role,
        orders: o?._count ?? 0,
        sales: toCents(o?._sum.total ?? 0),
      };
    });
    res.json({ rows });
  }),
);

reportsRouter.get(
  "/stock",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    const rows = await stockMovementReport(req.auth!.restaurantId, { from, to });
    if (req.query.format === "csv") {
      const csv = toCsv(
        ["Date", "Ingredient", "Type", "Qty", "Unit", "Reason"],
        rows.map((m) => [m.createdAt, m.ingredient.name, m.type, Number(m.quantity), m.ingredient.stockUnit, m.reason ?? ""]),
      );
      res.header("Content-Type", "text/csv").attachment("stock-movements.csv").send(csv);
      return;
    }
    res.json({ rows });
  }),
);

reportsRouter.get(
  "/wastage",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    const report = await wastageReport(req.auth!.restaurantId, { from, to });
    res.json(report);
  }),
);

reportsRouter.get(
  "/food-cost",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    const report = await foodCostPercent(req.auth!.restaurantId, from, to);
    res.json(report);
  }),
);

reportsRouter.get(
  "/z-report",
  asyncHandler(async (req, res) => {
    const { date } = req.query as { date?: string };
    const businessDate = date ? new Date(date) : new Date();
    const report = await zReport(req.auth!.restaurantId, businessDate);
    res.json({ report });
  }),
);

const closeDaySchema = z.object({
  date: z.string().datetime().optional(),
  actualCash: z.number().nonnegative(),
  notes: z.string().max(300).optional(),
});

reportsRouter.post(
  "/z-report/close",
  requirePermission("report.z"),
  validate({ body: closeDaySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof closeDaySchema>;
    const result = await closeBusinessDay(
      req.auth!.restaurantId,
      req.auth!.userId,
      body.date ? new Date(body.date) : new Date(),
      toCents(body.actualCash),
      body.notes,
    );
    res.json({
      close: { ...result.close, expectedCash: fromCents(toCents(result.close.expectedCash)), actualCash: fromCents(toCents(result.close.actualCash)), variance: fromCents(toCents(result.close.variance)) },
      variance: fromCents(result.variance),
      report: result.report,
    });
  }),
);

reportsRouter.get(
  "/day-closes",
  requirePermission("report.z"),
  asyncHandler(async (req, res) => {
    const closes = await prisma.businessDayClose.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      orderBy: { businessDate: "desc" },
      take: 60,
    });
    res.json({ closes });
  }),
);

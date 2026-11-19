import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit } from "../lib/audit.js";
import { resolveCapabilities } from "../lib/permissions.js";
import { clockIn, clockOut, copyRosterWeek, paySummary, saveTipEntry } from "../services/payroll.service.js";

export const payrollRouter = Router();
payrollRouter.use(requireAuth);
// The whole pay area is off-limits to admins: only managers (schedule/attendance)
// and the owner / payroll.view holders (pay records) may reach any of it.
payrollRouter.use(async (req, _res, next) => {
  try {
    const caps = await resolveCapabilities(req.auth!.userId, req.auth!.role);
    if (!caps.includes("attendance.edit") && !caps.includes("payroll.view")) {
      return next(ApiError.forbidden("No access to the employee pay area"));
    }
    next();
  } catch (e) {
    next(e);
  }
});

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const asDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
const rangeQuery = (query: Record<string, string | undefined>) => {
  const to = query.to ?? new Date().toISOString().slice(0, 10);
  const from = query.from ?? to;
  return { from: asDay(from), to: asDay(to) };
};

async function assertEmployee(restaurantId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, restaurantId } });
  if (!employee) throw ApiError.notFound("Employee not found");
  return employee;
}

/* ── Roster (managers may view; owner edits) ──────────────────────────────── */

payrollRouter.get(
  "/roster",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.rosterShift.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      include: { employee: { select: { id: true, firstName: true, lastName: true, position: true } } },
      orderBy: [{ dayOfWeek: "asc" }, { shift: "asc" }],
    });
    res.json({ rows });
  }),
);

const rosterSchema = z.object({
  employeeId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  shift: z.enum(["MORNING", "EVENING", "NIGHT"]),
  position: z.string().max(60).optional().nullable(),
});

payrollRouter.post(
  "/roster",
  requirePermission("employee.manage"),
  validate({ body: rosterSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof rosterSchema>;
    await assertEmployee(req.auth!.restaurantId, b.employeeId);
    const row = await prisma.rosterShift.upsert({
      where: {
        restaurantId_employeeId_dayOfWeek_shift: {
          restaurantId: req.auth!.restaurantId,
          employeeId: b.employeeId,
          dayOfWeek: b.dayOfWeek,
          shift: b.shift,
        },
      },
      create: { ...b, restaurantId: req.auth!.restaurantId },
      update: { position: b.position ?? null },
    });
    res.status(201).json({ row });
  }),
);

payrollRouter.post(
  "/roster/copy",
  requirePermission("employee.manage"),
  asyncHandler(async (req, res) => {
    res.json(await copyRosterWeek(req.auth!.restaurantId));
  }),
);

payrollRouter.delete(
  "/roster/:id",
  requirePermission("employee.manage"),
  asyncHandler(async (req, res) => {
    await prisma.rosterShift.deleteMany({ where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId } });
    res.json({ ok: true });
  }),
);

/* ── Attendance (manager corrections keep a reason) ──────────────────────── */

payrollRouter.get(
  "/attendance",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeQuery(req.query as Record<string, string | undefined>);
    const rows = await prisma.attendance.findMany({
      where: {
        restaurantId: req.auth!.restaurantId,
        businessDate: { gte: from, lte: to },
        ...(req.query.employeeId ? { employeeId: String(req.query.employeeId) } : {}),
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { businessDate: "desc" },
      take: 500,
    });
    res.json({ rows });
  }),
);

const clockSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/),
  terminalId: z.string().uuid().optional().nullable(),
});

payrollRouter.post(
  "/attendance/clock-in",
  requirePermission("attendance.edit"),
  validate({ body: clockSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof clockSchema>;
    const row = await clockIn({ restaurantId: req.auth!.restaurantId, pin: b.pin, terminalId: b.terminalId });
    res.status(201).json({ row });
  }),
);

payrollRouter.post(
  "/attendance/clock-out",
  requirePermission("attendance.edit"),
  validate({ body: clockSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof clockSchema>;
    res.json({ row: await clockOut({ restaurantId: req.auth!.restaurantId, pin: b.pin, terminalId: b.terminalId }) });
  }),
);

const attendanceEditSchema = z.object({
  clockIn: z.string().datetime(),
  clockOut: z.string().datetime().optional().nullable(),
  breakMinutes: z.number().int().min(0).max(600).optional(),
  reason: z.string().min(2),
});

payrollRouter.patch(
  "/attendance/:id",
  requirePermission("attendance.edit"),
  validate({ body: attendanceEditSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof attendanceEditSchema>;
    const existing = await prisma.attendance.findFirst({ where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId } });
    if (!existing) throw ApiError.notFound("Attendance record not found");
    const row = await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        clockIn: new Date(b.clockIn),
        clockOut: b.clockOut ? new Date(b.clockOut) : null,
        ...(b.breakMinutes !== undefined ? { breakMinutes: b.breakMinutes } : {}),
        method: "MANUAL",
        editedById: req.auth!.userId,
        editReason: b.reason,
      },
    });
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "ATTENDANCE_CORRECTED",
      entityType: "Attendance",
      entityId: row.id,
      before: { clockIn: existing.clockIn.toISOString(), clockOut: existing.clockOut?.toISOString() ?? null },
      after: { clockIn: row.clockIn.toISOString(), clockOut: row.clockOut?.toISOString() ?? null },
      reason: b.reason,
    });
    res.json({ row });
  }),
);

/* ── Pay records (owner only) ─────────────────────────────────────────────── */

const moneyRecordSchema = z.object({
  employeeId: z.string().uuid(),
  date: dateField,
  amount: z.number().positive(),
  reason: z.string().max(300).optional().nullable(),
  acknowledged: z.boolean().optional(),
});

payrollRouter.get(
  "/advances",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeQuery(req.query as Record<string, string | undefined>);
    const rows = await prisma.staffAdvance.findMany({
      where: { restaurantId: req.auth!.restaurantId, businessDate: { gte: from, lte: to } },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { businessDate: "desc" },
    });
    res.json({ rows });
  }),
);

payrollRouter.post(
  "/advances",
  requirePermission("employee.manage"),
  validate({ body: moneyRecordSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof moneyRecordSchema>;
    await assertEmployee(req.auth!.restaurantId, b.employeeId);
    const row = await prisma.staffAdvance.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        employeeId: b.employeeId,
        businessDate: asDay(b.date),
        amount: b.amount,
        reason: b.reason ?? null,
        acknowledged: b.acknowledged ?? false,
      },
    });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "STAFF_ADVANCE", entityType: "StaffAdvance", entityId: row.id, after: { amount: b.amount }, reason: b.reason });
    res.status(201).json({ row });
  }),
);

payrollRouter.get(
  "/deductions",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeQuery(req.query as Record<string, string | undefined>);
    const rows = await prisma.staffDeduction.findMany({
      where: { restaurantId: req.auth!.restaurantId, businessDate: { gte: from, lte: to } },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { businessDate: "desc" },
    });
    res.json({ rows });
  }),
);

payrollRouter.post(
  "/deductions",
  requirePermission("employee.manage"),
  validate({ body: moneyRecordSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof moneyRecordSchema>;
    await assertEmployee(req.auth!.restaurantId, b.employeeId);
    const row = await prisma.staffDeduction.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        employeeId: b.employeeId,
        businessDate: asDay(b.date),
        amount: b.amount,
        reason: b.reason ?? null,
        acknowledged: b.acknowledged ?? false,
      },
    });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "STAFF_DEDUCTION", entityType: "StaffDeduction", entityId: row.id, after: { amount: b.amount }, reason: b.reason });
    res.status(201).json({ row });
  }),
);

const mealSchema = z.object({
  employeeId: z.string().uuid(),
  date: dateField,
  count: z.number().int().min(1).max(50).default(1),
  cost: z.number().nonnegative().optional().nullable(),
  note: z.string().max(200).optional().nullable(),
});

payrollRouter.get(
  "/meals",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeQuery(req.query as Record<string, string | undefined>);
    const rows = await prisma.staffMeal.findMany({
      where: { restaurantId: req.auth!.restaurantId, businessDate: { gte: from, lte: to } },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { businessDate: "desc" },
    });
    res.json({ rows });
  }),
);

payrollRouter.post(
  "/meals",
  requirePermission("employee.manage"),
  validate({ body: mealSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof mealSchema>;
    await assertEmployee(req.auth!.restaurantId, b.employeeId);
    const row = await prisma.staffMeal.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        employeeId: b.employeeId,
        businessDate: asDay(b.date),
        count: b.count,
        cost: b.cost ?? null,
        note: b.note ?? null,
      },
    });
    res.status(201).json({ row });
  }),
);

const tipSchema = z.object({
  date: dateField,
  tipAmount: z.number().nonnegative(),
  serviceCharge: z.number().nonnegative().default(0),
  rule: z.enum(["EQUAL", "HOURS", "POINTS"]),
  points: z.record(z.string(), z.number().nonnegative()).optional(),
});

payrollRouter.get(
  "/tips",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeQuery(req.query as Record<string, string | undefined>);
    const rows = await prisma.tipEntry.findMany({
      where: { restaurantId: req.auth!.restaurantId, businessDate: { gte: from, lte: to } },
      orderBy: { businessDate: "desc" },
    });
    res.json({ rows });
  }),
);

payrollRouter.post(
  "/tips",
  requirePermission("employee.manage"),
  validate({ body: tipSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof tipSchema>;
    const row = await saveTipEntry({
      restaurantId: req.auth!.restaurantId,
      businessDate: asDay(b.date),
      tipAmount: b.tipAmount,
      serviceCharge: b.serviceCharge,
      rule: b.rule,
      points: b.points,
      enteredById: req.auth!.userId,
    });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "TIPS_RECORDED", entityType: "TipEntry", entityId: row.id, after: { date: b.date, rule: b.rule, tipAmount: b.tipAmount } });
    res.status(201).json({ row });
  }),
);

const noteSchema = z.object({
  employeeId: z.string().uuid(),
  note: z.string().min(2).max(2000),
});

payrollRouter.get(
  "/notes",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.employeeNote.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      include: { employee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ rows });
  }),
);

payrollRouter.post(
  "/notes",
  requirePermission("employee.manage"),
  validate({ body: noteSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof noteSchema>;
    await assertEmployee(req.auth!.restaurantId, b.employeeId);
    const row = await prisma.employeeNote.create({
      data: { restaurantId: req.auth!.restaurantId, employeeId: b.employeeId, note: b.note, authorId: req.auth!.userId },
    });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "EMPLOYEE_NOTE", entityType: "EmployeeNote", entityId: row.id, reason: b.note });
    res.status(201).json({ row });
  }),
);

payrollRouter.get(
  "/summary",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => {
    const { from, to } = rangeQuery(req.query as Record<string, string | undefined>);
    res.json(await paySummary(req.auth!.restaurantId, from, to));
  }),
);

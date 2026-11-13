import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit, clientIp } from "../lib/audit.js";
import { ok } from "../lib/respond.js";
import { assertCanManage } from "../lib/userGuards.js";
import type { Role } from "@prisma/client";

export const employeesRouter = Router();
employeesRouter.use(requireAuth);

const employeeSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().max(60).optional().nullable(),
  phone: z.string().max(32).optional().nullable(),
  emergencyContact: z.string().max(120).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  idNumber: z.string().max(60).optional().nullable(),
  position: z.string().max(60).optional().nullable(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "LEFT"]).optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  payType: z.enum(["MONTHLY", "DAILY", "HOURLY"]).optional().nullable(),
  payRate: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
});

// Only the owner (or anyone granted employee.view) may read staff records.
employeesRouter.get(
  "/",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const employees = await prisma.employee.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      orderBy: [{ status: "asc" }, { firstName: "asc" }],
    });
    ok(res, { employees }, "Employees loaded");
  }),
);

employeesRouter.post(
  "/",
  requirePermission("employee.manage"),
  validate({ body: employeeSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof employeeSchema>;
    // Owners manage employee records; rank check only when linking a user account.
    if (b.userId) {
      const target = await prisma.user.findFirst({ where: { id: b.userId, restaurantId: req.auth!.restaurantId, deletedAt: null } });
      if (!target) throw ApiError.notFound("User not found");
      assertCanManage(req.auth!.role as Role, target.role as Role);
    }
    const employee = await prisma.employee.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        firstName: b.firstName,
        lastName: b.lastName ?? null,
        phone: b.phone ?? null,
        emergencyContact: b.emergencyContact ?? null,
        address: b.address ?? null,
        idNumber: b.idNumber ?? null,
        position: b.position ?? null,
        status: b.status ?? "ACTIVE",
        startDate: b.startDate ? new Date(b.startDate) : null,
        endDate: b.endDate ? new Date(b.endDate) : null,
        payType: b.payType ?? null,
        payRate: b.payRate ?? null,
        notes: b.notes ?? null,
        userId: b.userId ?? null,
      },
    });
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "EMPLOYEE_CREATE",
      entityType: "Employee",
      entityId: employee.id,
      after: { name: `${employee.firstName} ${employee.lastName ?? ""}`.trim(), status: employee.status },
      ipAddress: clientIp(req),
    });
    ok(res, { employee }, "Employee created", 201);
  }),
);

employeesRouter.get(
  "/:id",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => {
    const employee = await prisma.employee.findFirst({
      where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId },
    });
    if (!employee) throw ApiError.notFound("Employee not found");
    ok(res, { employee }, "Employee loaded");
  }),
);

employeesRouter.patch(
  "/:id",
  requirePermission("employee.manage"),
  validate({ body: employeeSchema.partial() }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof employeeSchema>;
    const existing = await prisma.employee.findFirst({
      where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId },
    });
    if (!existing) throw ApiError.notFound("Employee not found");
    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: {
        ...(b.firstName !== undefined ? { firstName: b.firstName } : {}),
        ...(b.lastName !== undefined ? { lastName: b.lastName } : {}),
        ...(b.phone !== undefined ? { phone: b.phone } : {}),
        ...(b.emergencyContact !== undefined ? { emergencyContact: b.emergencyContact } : {}),
        ...(b.address !== undefined ? { address: b.address } : {}),
        ...(b.idNumber !== undefined ? { idNumber: b.idNumber } : {}),
        ...(b.position !== undefined ? { position: b.position } : {}),
        ...(b.status !== undefined ? { status: b.status } : {}),
        ...(b.startDate !== undefined ? { startDate: b.startDate ? new Date(b.startDate) : null } : {}),
        ...(b.endDate !== undefined ? { endDate: b.endDate ? new Date(b.endDate) : null } : {}),
        ...(b.payType !== undefined ? { payType: b.payType } : {}),
        ...(b.payRate !== undefined ? { payRate: b.payRate } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
        ...(b.userId !== undefined ? { userId: b.userId } : {}),
      },
    });
    ok(res, { employee }, "Employee updated");
  }),
);

employeesRouter.delete(
  "/:id",
  requirePermission("employee.manage"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.employee.findFirst({
      where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId },
    });
    if (!existing) throw ApiError.notFound("Employee not found");
    await prisma.employee.update({ where: { id: existing.id }, data: { status: "LEFT", endDate: new Date() } });
    ok(res, { ok: true }, "Employee deactivated");
  }),
);

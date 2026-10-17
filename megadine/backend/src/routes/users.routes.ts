import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit, clientIp } from "../lib/audit.js";
import { hashPassword, hashPin } from "../lib/auth.js";
import { ok } from "../lib/respond.js";
import { toUserResponse } from "../lib/userResponse.js";
import { ADMIN_GUARD_ROLES, assertNotLastAdmin, assertNotSelfDeactivate, releaseUnique } from "../lib/userGuards.js";
import { SUPPORTED_LANGUAGES } from "../lib/env.js";
import { startOfDay } from "../lib/businessDay.js";
import { fromCents, toCents } from "../lib/money.js";
import type { Role } from "@prisma/client";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const ROLE_ENUM = z.enum(["OWNER", "ADMIN", "MANAGER", "CASHIER", "WAITER", "KITCHEN"]);

const USER_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  restaurantId: true,
  preferredLanguage: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ── Own language preference (any authenticated user) ────────────────────────
usersRouter.patch(
  "/me/language",
  asyncHandler(async (req, res) => {
    const lang = String(req.query.lang ?? "");
    if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
      throw ApiError.badRequest(`Unsupported language "${lang}". Supported: ${SUPPORTED_LANGUAGES.join(", ")}`);
    }
    const user = await prisma.user.update({
      where: { id: req.auth!.userId },
      data: { preferredLanguage: lang },
      select: USER_SELECT,
    });
    ok(res, { user: toUserResponse(user) }, "Language updated");
  }),
);

// ── List ─────────────────────────────────────────────────────────────────────
usersRouter.get(
  "/",
  requirePermission("staff.manage"),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { restaurantId: req.auth!.restaurantId, deletedAt: null },
      select: USER_SELECT,
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
    ok(res, { users: users.map(toUserResponse) }, "Users loaded");
  }),
);

// ── Get one ──────────────────────────────────────────────────────────────────
usersRouter.get(
  "/:id",
  requirePermission("staff.manage"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!user) throw ApiError.notFound("User not found");
    ok(res, { user: toUserResponse(user) }, "User loaded");
  }),
);

const createSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, dot, underscore or dash"),
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().max(32).optional().nullable(),
  role: ROLE_ENUM,
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  isActive: z.boolean().optional(),
});

async function assertUsernameFree(username: string, excludeId?: string) {
  const clash = await prisma.user.findFirst({
    where: { username, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ApiError(409, "validation.duplicate.username", "That username is already taken");
}

async function assertEmailFree(email: string, excludeId?: string) {
  const clash = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ApiError(409, "validation.duplicate.email", "That email is already registered");
}

// ── Create ───────────────────────────────────────────────────────────────────
usersRouter.post(
  "/",
  requirePermission("staff.manage"),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    const email = b.email.toLowerCase();
    await assertUsernameFree(b.username);
    await assertEmailFree(email);

    const user = await prisma.user.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        name: `${b.firstName} ${b.lastName}`,
        username: b.username,
        firstName: b.firstName,
        lastName: b.lastName,
        phone: b.phone ?? null,
        email,
        role: b.role,
        isActive: b.isActive ?? true,
        passwordHash: await hashPassword(b.password),
        passwordChangedAt: new Date(),
        pinHash: b.pin ? await hashPin(b.pin) : null,
      },
      select: USER_SELECT,
    });
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "USER_CREATE",
      entityType: "User",
      entityId: user.id,
      after: { role: user.role, isActive: user.isActive },
      ipAddress: clientIp(req),
    });
    ok(res, { user: toUserResponse(user) }, "User created", 201);
  }),
);

const updateSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().max(32).nullable().optional(),
  role: ROLE_ENUM.optional(),
  pin: z.string().regex(/^\d{4,6}$/).nullable().optional(),
  isActive: z.boolean().optional(),
});

// ── Update ───────────────────────────────────────────────────────────────────
usersRouter.put(
  "/:id",
  requirePermission("staff.manage"),
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof updateSchema>;
    const id = String(req.params.id);
    const target = await prisma.user.findFirst({
      where: { id, restaurantId: req.auth!.restaurantId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!target) throw ApiError.notFound("User not found");

    if (b.role !== undefined && b.role !== target.role) {
      if (ADMIN_GUARD_ROLES.includes(target.role as Role) && !ADMIN_GUARD_ROLES.includes(b.role as Role)) {
        await assertNotLastAdmin(req.auth!.restaurantId, id, "demote");
      }
    }
    if (b.isActive === false && target.isActive) {
      assertNotSelfDeactivate(req.auth!.userId, id);
      await assertNotLastAdmin(req.auth!.restaurantId, id, "deactivate");
    }

    let email: string | undefined;
    if (b.email !== undefined) {
      email = b.email.toLowerCase();
      await assertEmailFree(email, id);
    }

    const firstName = b.firstName ?? target.firstName ?? target.name.split(" ")[0] ?? "";
    const lastName = b.lastName ?? target.lastName ?? target.name.split(" ").slice(1).join(" ");

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(b.firstName !== undefined || b.lastName !== undefined ? { name: `${firstName} ${lastName}`.trim(), firstName, lastName } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(b.phone !== undefined ? { phone: b.phone } : {}),
        ...(b.role !== undefined ? { role: b.role } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
        ...(b.password ? { passwordHash: await hashPassword(b.password), passwordChangedAt: new Date() } : {}),
        ...(b.pin !== undefined ? { pinHash: b.pin ? await hashPin(b.pin) : null } : {}),
      },
      select: USER_SELECT,
    });
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "USER_UPDATE",
      entityType: "User",
      entityId: user.id,
      before: { role: target.role, isActive: target.isActive },
      after: { role: user.role, isActive: user.isActive },
      ipAddress: clientIp(req),
    });
    ok(res, { user: toUserResponse(user) }, "User updated");
  }),
);

// ── Soft delete ──────────────────────────────────────────────────────────────
usersRouter.delete(
  "/:id",
  requirePermission("staff.manage"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    assertNotSelfDeactivate(req.auth!.userId, id);
    await assertNotLastAdmin(req.auth!.restaurantId, id, "delete");

    const target = await prisma.user.findFirst({
      where: { id, restaurantId: req.auth!.restaurantId, deletedAt: null },
      select: { id: true, username: true, email: true },
    });
    if (!target) throw ApiError.notFound("User not found");

    await prisma.$transaction([
      prisma.user.update({
        where: { id: target.id },
        data: {
          // Free the unique handles so a future account can reuse them.
          username: releaseUnique(target.username, target.id),
          email: releaseUnique(target.email, target.id),
          deletedAt: new Date(),
          isActive: false,
        },
      }),
      // Force logout everywhere.
      prisma.session.deleteMany({ where: { userId: target.id } }),
    ]);
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "USER_DELETE",
      entityType: "User",
      entityId: target.id,
      before: { username: target.username, email: target.email },
      ipAddress: clientIp(req),
    });
    ok(res, { id: target.id }, "User deleted");
  }),
);

// ── Sales performance stats ──────────────────────────────────────────────────
usersRouter.get(
  "/:id/stats",
  requirePermission("staff.manage"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const user = await prisma.user.findFirst({
      where: { id, restaurantId: req.auth!.restaurantId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw ApiError.notFound("User not found");

    const base = { cashierId: id, restaurantId: req.auth!.restaurantId, status: "COMPLETED" as const };
    const [all, today] = await Promise.all([
      prisma.order.aggregate({ where: base, _count: { _all: true }, _sum: { total: true } }),
      prisma.order.aggregate({
        where: { ...base, createdAt: { gte: startOfDay(new Date()) } },
        _count: { _all: true },
        _sum: { total: true },
      }),
    ]);

    ok(
      res,
      {
        totalSales: all._count._all,
        totalRevenue: Number(fromCents(toCents(all._sum.total ?? 0))),
        todaySales: today._count._all,
        todayRevenue: Number(fromCents(toCents(today._sum.total ?? 0))),
      },
      "Stats loaded",
    );
  }),
);

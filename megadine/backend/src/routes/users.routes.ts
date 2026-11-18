import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit, clientIp } from "../lib/audit.js";
import { hashPassword, hashPin, passwordValidationError, verifyPassword, verifyPin } from "../lib/auth.js";
import { pinForStorage } from "../lib/pin.js";
import { ok } from "../lib/respond.js";
import { toUserResponse } from "../lib/userResponse.js";
import { ADMIN_GUARD_ROLES, assertCanManage, assertNotLastAdmin, assertNotSelfDeactivate, releaseUnique } from "../lib/userGuards.js";
import { SUPPORTED_LANGUAGES } from "../lib/env.js";
import { startOfDay } from "../lib/businessDay.js";
import { fromCents, toCents } from "../lib/money.js";
import { disconnectUser } from "../lib/socket.js";
import { randomInt } from "node:crypto";
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
  mustChangeCredential: true,
  lockoutUntil: true,
  failedPinAttempts: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * A person cannot be deactivated while they still own an open cash shift or
 * open orders: the shift could never be closed and the history would lose its
 * owner (roles/access §"Admin: user management").
 */
async function assertNoOpenWork(restaurantId: string, userId: string) {
  const [openShifts, openOrders] = await Promise.all([
    prisma.cashShift.count({ where: { restaurantId, cashierId: userId, status: { in: ["OPEN", "REOPENED_BY_ADJUSTMENT"] } } }),
    prisma.order.count({
      where: {
        restaurantId,
        cashierId: userId,
        status: { in: ["DRAFT", "SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"] },
      },
    }),
  ]);
  if (openShifts > 0 || openOrders > 0) {
    throw ApiError.conflict(
      `Cannot deactivate: this person has ${openShifts} open shift(s) and ${openOrders} open order(s). Close them first.`,
    );
  }
}

// -- Own language preference (any authenticated user) ------------------------
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

// -- List ---------------------------------------------------------------------
usersRouter.get(
  "/",
  requirePermission("user.view"),
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const role = String(req.query.role ?? "");
    const status = String(req.query.status ?? "");
    const locked = String(req.query.locked ?? "") === "true";
    const mustChange = String(req.query.mustChange ?? "") === "true";
    const neverSignedIn = String(req.query.neverSignedIn ?? "") === "true";

    const users = await prisma.user.findMany({
      where: {
        restaurantId: req.auth!.restaurantId,
        deletedAt: null,
        ...(role ? { role: role as Role } : {}),
        ...(status === "active" ? { isActive: true } : {}),
        ...(status === "inactive" ? { isActive: false } : {}),
        ...(locked ? { lockoutUntil: { gt: new Date() } } : {}),
        ...(mustChange ? { mustChangeCredential: true } : {}),
        ...(neverSignedIn ? { lastLoginAt: null } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { username: { contains: q, mode: "insensitive" as const } },
                { email: { contains: q, mode: "insensitive" as const } },
                { phone: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: {
        ...USER_SELECT,
        sessions: { orderBy: { lastSeenAt: "desc" }, take: 1, select: { terminalId: true, lastSeenAt: true } },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
    const { resolveCapabilities } = await import("../lib/permissions.js");
    const enriched = await Promise.all(
      users.map(async (u) => {
        const { sessions, ...base } = u as typeof u & { sessions: { terminalId: string | null; lastSeenAt: Date }[] };
        return {
          ...toUserResponse(base, await resolveCapabilities(u.id, u.role as Role)),
          lastTerminal: sessions[0]?.terminalId ?? null,
          lastSeenAt: sessions[0]?.lastSeenAt ?? null,
          locked: !!u.lockoutUntil && u.lockoutUntil > new Date(),
        };
      }),
    );
    ok(res, { users: enriched }, "Users loaded");
  }),
);

// -- Get one ------------------------------------------------------------------
usersRouter.get(
  "/:id",
  requirePermission("user.view"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!user) throw ApiError.notFound("User not found");
    const effective = await (await import("../lib/permissions.js")).resolveCapabilities(user.id, user.role as Role);
    ok(res, { user: toUserResponse(user, effective) }, "User loaded");
  }),
);

const createSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, dot, underscore or dash"),
  email: z.string().email().optional().nullable(),
  password: z.string().min(8).optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().max(32).optional().nullable(),
  role: ROLE_ENUM,
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  isActive: z.boolean().optional(),
  // When true (default) the issued credential is temporary and must be changed
  // at first sign-in (roles redesign Â§"Temporary credentials").
  temporary: z.boolean().optional(),
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

// -- Create -------------------------------------------------------------------
usersRouter.post(
  "/",
  requirePermission("user.create"),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    await assertCanManage(req.auth!.role as Role, b.role as Role);
    await assertUsernameFree(b.username);
    const email = b.email ? b.email.toLowerCase() : null;
    if (email) await assertEmailFree(email);

    // Passwords are required for back-office roles; floor staff may be PIN-only.
    const needsPassword = ["OWNER", "ADMIN", "MANAGER"].includes(b.role);
    if (needsPassword && !b.password) {
      throw ApiError.badRequest("A password is required for this role");
    }
    if (!needsPassword && !b.password && !b.pin) {
      throw ApiError.badRequest("Provide a password or a PIN for this account");
    }
    if (b.password) {
      const pwError = passwordValidationError(b.password, { username: b.username, email });
      if (pwError) throw ApiError.badRequest(pwError);
    }

    const pinLookupValue = b.pin ? await pinForStorage(req.auth!.restaurantId, b.pin) : null;
    const temporary = b.temporary ?? true;

    const user = await prisma.user.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        name: `${b.firstName} ${b.lastName}`.trim(),
        username: b.username,
        firstName: b.firstName,
        lastName: b.lastName,
        phone: b.phone ?? null,
        email,
        role: b.role,
        isActive: b.isActive ?? true,
        passwordHash: b.password ? await hashPassword(b.password) : null,
        passwordChangedAt: b.password ? new Date() : null,
        pinHash: b.pin ? await hashPin(b.pin) : null,
        pinLookup: pinLookupValue,
        mustChangeCredential: temporary,
      },
      select: USER_SELECT,
    });
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "USER_CREATE",
      entityType: "User",
      entityId: user.id,
      after: { role: user.role, isActive: user.isActive, temporary },
      ipAddress: clientIp(req),
    });
    const effective = await (await import("../lib/permissions.js")).resolveCapabilities(user.id, user.role as Role);
    ok(res, { user: toUserResponse(user, effective), temporaryCredential: temporary }, "User created", 201);
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

// -- Update -------------------------------------------------------------------
usersRouter.put(
  "/:id",
  requirePermission("user.edit"),
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof updateSchema>;
    const id = String(req.params.id);
    const target = await prisma.user.findFirst({
      where: { id, restaurantId: req.auth!.restaurantId, deletedAt: null },
      select: USER_SELECT,
    });
    if (!target) throw ApiError.notFound("User not found");

    // Rank rules: an actor may only touch accounts below them, and may only
    // grant roles below their own. Self-actions are handled by the last-admin
    // and self-deactivate guards below.
    if (req.auth!.userId !== id) {
      assertCanManage(req.auth!.role as Role, target.role as Role);
      if (b.role !== undefined && b.role !== target.role) {
        assertCanManage(req.auth!.role as Role, b.role as Role);
      }
    }
    if (b.role !== undefined && b.role !== target.role) {
      const { resolveCapabilities } = await import("../lib/permissions.js");
      const caps = await resolveCapabilities(req.auth!.userId, req.auth!.role as Role);
      if (!caps.includes("user.assign_role")) {
        throw ApiError.forbidden("You cannot change roles");
      }
      if (ADMIN_GUARD_ROLES.includes(target.role as Role) && !ADMIN_GUARD_ROLES.includes(b.role as Role)) {
        await assertNotLastAdmin(req.auth!.restaurantId, id, "demote");
      }
    }
    if (b.isActive === false && target.isActive) {
      assertNotSelfDeactivate(req.auth!.userId, id);
      await assertNotLastAdmin(req.auth!.restaurantId, id, "deactivate");
      await assertNoOpenWork(req.auth!.restaurantId, id);
    }

    let email: string | undefined;
    if (b.email !== undefined) {
      email = b.email.toLowerCase();
      await assertEmailFree(email, id);
    }
    if (b.password) {
      const pwError = passwordValidationError(b.password, { username: target.username, email });
      if (pwError) throw ApiError.badRequest(pwError);
    }

    // A new PIN must validate and be unique in the cafe; clearing it must also
    // free the lookup value or a future person could never use that PIN.
    const pinChange =
      b.pin === undefined
        ? {}
        : b.pin
          ? { pinHash: await hashPin(b.pin), pinLookup: await pinForStorage(req.auth!.restaurantId, b.pin, id) }
          : { pinHash: null, pinLookup: null };

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
        ...(b.password ? { passwordHash: await hashPassword(b.password), passwordChangedAt: new Date(), ...(req.auth!.userId !== id ? { mustChangeCredential: true } : {}) } : {}),
        ...pinChange,
        ...(b.pin !== undefined && req.auth!.userId !== id ? { mustChangeCredential: true } : {}),
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
    const effective = await (await import("../lib/permissions.js")).resolveCapabilities(user.id, user.role as Role);
    if (b.isActive === false) disconnectUser(id);
    ok(res, { user: toUserResponse(user, effective) }, "User updated");
  }),
);

// -- Soft delete --------------------------------------------------------------
usersRouter.delete(
  "/:id",
  requirePermission("user.deactivate"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    assertNotSelfDeactivate(req.auth!.userId, id);
    await assertNotLastAdmin(req.auth!.restaurantId, id, "delete");
    await assertNoOpenWork(req.auth!.restaurantId, id);

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
          pinLookup: null,
          deletedAt: new Date(),
          isActive: false,
        },
      }),
      // Force logout everywhere.
      prisma.session.deleteMany({ where: { userId: target.id } }),
    ]);
    disconnectUser(target.id);
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

// -- Sales performance stats --------------------------------------------------
// Sessions and device list (roles redesign).
async function loadManagedUser(req: { auth?: { restaurantId: string; userId: string; role: Role }; params: Record<string, string | undefined> }) {
  const id = String(req.params.id);
  const target = await prisma.user.findFirst({
    where: { id, restaurantId: req.auth!.restaurantId, deletedAt: null },
    select: { id: true, role: true, username: true, email: true, restaurantId: true },
  });
  if (!target) throw ApiError.notFound("User not found");
  if (req.auth!.userId !== id) assertCanManage(req.auth!.role, target.role as Role);
  return target;
}

usersRouter.get(
  "/:id/sessions",
  requirePermission("user.view"),
  asyncHandler(async (req, res) => {
    const target = await loadManagedUser(req as never);
    const sessions = await prisma.session.findMany({
      where: { userId: target.id },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, terminalId: true, lastSeenAt: true, createdAt: true, expiresAt: true },
    });
    ok(
      res,
      { sessions: sessions.map((s) => ({ ...s, current: s.id === req.auth!.sessionId })) },
      "Sessions loaded",
    );
  }),
);

usersRouter.delete(
  "/:id/sessions",
  requirePermission("user.edit"),
  asyncHandler(async (req, res) => {
    const target = await loadManagedUser(req as never);
    const result = await prisma.session.deleteMany({
      where: { userId: target.id, ...(req.auth!.userId === target.id ? { id: { not: req.auth!.sessionId } } : {}) },
    });
    disconnectUser(target.id);
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "USER_SESSIONS_REVOKED",
      entityType: "User",
      entityId: target.id,
      after: { count: result.count },
      ipAddress: clientIp(req),
    });
    ok(res, { revoked: result.count }, "Signed out everywhere");
  }),
);

usersRouter.delete(
  "/:id/sessions/:sessionId",
  requirePermission("user.edit"),
  asyncHandler(async (req, res) => {
    const target = await loadManagedUser(req as never);
    const sessionId = String(req.params.sessionId);
    await prisma.session.deleteMany({ where: { id: sessionId, userId: target.id } });
    disconnectUser(target.id);
    ok(res, { id: sessionId }, "Session revoked");
  }),
);

usersRouter.post(
  "/:id/unlock",
  requirePermission("user.edit"),
  asyncHandler(async (req, res) => {
    const target = await loadManagedUser(req as never);
    await prisma.user.update({ where: { id: target.id }, data: { failedPinAttempts: 0, lockoutUntil: null } });
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "USER_UNLOCKED",
      entityType: "User",
      entityId: target.id,
      ipAddress: clientIp(req),
    });
    ok(res, { id: target.id }, "User unlocked");
  }),
);

usersRouter.post(
  "/:id/lock",
  requirePermission("user.edit"),
  asyncHandler(async (req, res) => {
    const target = await loadManagedUser(req as never);
    await prisma.user.update({ where: { id: target.id }, data: { lockoutUntil: new Date(Date.now() + 60 * 60_000) } });
    disconnectUser(target.id);
    ok(res, { id: target.id }, "User locked for an hour");
  }),
);

// One-time credential reset (roles redesign, "Temporary credentials").
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 12; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

async function generatePin(restaurantId: string): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const pin = String(randomInt(1000, 10000));
    if (/^(\d)\1+$/.test(pin) || ["1234", "0123", "0000"].includes(pin)) continue;
    try {
      await pinForStorage(restaurantId, pin);
      return pin;
    } catch {
      /* clash: try again */
    }
  }
  throw ApiError.conflict("Could not allocate a unique PIN");
}

usersRouter.post(
  "/:id/reset-credential",
  requirePermission("user.reset_credential"),
  validate({ body: z.object({ type: z.enum(["PASSWORD", "PIN"]).optional() }) }),
  asyncHandler(async (req, res) => {
    const target = await loadManagedUser(req as never);
    const type = (req.body as { type?: "PASSWORD" | "PIN" }).type ?? (["OWNER", "ADMIN", "MANAGER"].includes(target.role) ? "PASSWORD" : "PIN");
    const credential = type === "PIN" ? await generatePin(target.restaurantId) : generatePassword();

    await prisma.user.update({
      where: { id: target.id },
      data: {
        mustChangeCredential: true,
        failedPinAttempts: 0,
        lockoutUntil: null,
        ...(type === "PIN"
          ? { pinHash: await hashPin(credential), pinLookup: await pinForStorage(target.restaurantId, credential, target.id) }
          : { passwordHash: await hashPassword(credential), passwordChangedAt: new Date() }),
      },
    });
    await prisma.session.deleteMany({ where: { userId: target.id } });
    disconnectUser(target.id);
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "USER_CREDENTIAL_RESET",
      entityType: "User",
      entityId: target.id,
      after: { type },
      ipAddress: clientIp(req),
    });
    // The plaintext is returned exactly once and never stored or logged.
    ok(res, { credential, type }, "Temporary credential issued");
  }),
);

// Change my own credential (also clears mustChangeCredential).
usersRouter.patch(
  "/me/credential",
  validate({
    body: z.object({
      currentPassword: z.string().optional(),
      currentPin: z.string().regex(/^\d{4,6}$/).optional(),
      newPassword: z.string().min(8).optional(),
      newPin: z.string().regex(/^\d{4,6}$/).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const b = req.body as { currentPassword?: string; currentPin?: string; newPassword?: string; newPin?: string };
    if (!b.newPassword && !b.newPin) throw ApiError.badRequest("Provide a new password or PIN");
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (b.newPassword) {
      if (!me.passwordHash || !b.currentPassword || !(await verifyPassword(b.currentPassword, me.passwordHash))) {
        throw ApiError.unauthorized("Current password is incorrect");
      }
      const pwError = passwordValidationError(b.newPassword, { username: me.username, email: me.email });
      if (pwError) throw ApiError.badRequest(pwError);
    }
    if (b.newPin) {
      if (!me.pinHash || !b.currentPin || !(await verifyPin(b.currentPin, me.pinHash))) {
        throw ApiError.unauthorized("Current PIN is incorrect");
      }
    }
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: {
        ...(b.newPassword ? { passwordHash: await hashPassword(b.newPassword), passwordChangedAt: new Date() } : {}),
        ...(b.newPin ? { pinHash: await hashPin(b.newPin), pinLookup: await pinForStorage(me.restaurantId, b.newPin, me.id) } : {}),
        mustChangeCredential: false,
      },
      select: USER_SELECT,
    });
    await audit({
      restaurantId: me.restaurantId,
      userId: me.id,
      action: "USER_CREDENTIAL_CHANGED",
      entityType: "User",
      entityId: me.id,
      after: { password: !!b.newPassword, pin: !!b.newPin },
      ipAddress: clientIp(req),
    });
    const effective = await (await import("../lib/permissions.js")).resolveCapabilities(me.id, me.role as Role);
    ok(res, { user: toUserResponse(updated, effective) }, "Credential updated");
  }),
);

usersRouter.get(
  "/:id/stats",
  requirePermission("user.view"),
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
// -- Assignable roles (rank-aware) --------------------------------------------
usersRouter.get(
  "/meta/capabilities",
  requirePermission("user.view"),
  asyncHandler(async (_req, res) => {
    const { ALL_CAPABILITIES, ROLE_CAPABILITIES } = await import("../lib/permissions.js");
    ok(res, { capabilities: ALL_CAPABILITIES, defaults: ROLE_CAPABILITIES }, "Capabilities loaded");
  }),
);

usersRouter.get(
  "/roles/assignable",
  requirePermission("user.view"),
  asyncHandler(async (req, res) => {
    const { assignableRoles } = await import("../lib/userGuards.js");
    ok(res, { roles: assignableRoles(req.auth!.role as Role) }, "Assignable roles");
  }),
);

// -- Capability overrides -----------------------------------------------------
usersRouter.get(
  "/:id/capabilities",
  requirePermission("user.view"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const target = await prisma.user.findFirst({
      where: { id, restaurantId: req.auth!.restaurantId, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!target) throw ApiError.notFound("User not found");
    assertCanManage(req.auth!.role as Role, target.role as Role);
    const overrides = await prisma.userCapabilityOverride.findMany({ where: { userId: id } });
    const { resolveCapabilities } = await import("../lib/permissions.js");
    const effective = await resolveCapabilities(id, target.role as Role);
    ok(res, { role: target.role, effective, overrides }, "Capabilities loaded");
  }),
);

const overrideSchema = z.object({
  capability: z.string().min(1),
  granted: z.boolean(),
  reason: z.string().max(300).optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
});

usersRouter.put(
  "/:id/capabilities",
  requirePermission("user.edit"),
  validate({ body: z.object({ overrides: z.array(overrideSchema) }) }),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const target = await prisma.user.findFirst({
      where: { id, restaurantId: req.auth!.restaurantId, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!target) throw ApiError.notFound("User not found");
    assertCanManage(req.auth!.role as Role, target.role as Role);

    const { overrides } = req.body as { overrides: z.infer<typeof overrideSchema>[] };
    await prisma.userCapabilityOverride.deleteMany({ where: { userId: id } });
    if (overrides.length) {
      await prisma.userCapabilityOverride.createMany({
        data: overrides.map((o) => ({
          userId: id,
          capability: o.capability,
          granted: o.granted,
          reason: o.reason ?? null,
          endsAt: o.endsAt ? new Date(o.endsAt) : null,
          createdBy: req.auth!.userId,
        })),
      });
    }
    const { resolveCapabilities } = await import("../lib/permissions.js");
    const effective = await resolveCapabilities(id, target.role as Role);
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "USER_CAPABILITIES_UPDATED",
      entityType: "User",
      entityId: id,
      after: { count: overrides.length },
      ipAddress: clientIp(req),
    });
    ok(res, { effective }, "Capabilities updated");
  }),
);




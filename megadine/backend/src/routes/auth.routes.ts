import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { verifyPin, verifyPassword, newSessionToken, hashPin, hashToken, hashPassword } from "../lib/auth.js";
import { SESSION_COOKIE, requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { audit, clientIp } from "../lib/audit.js";
import { toUserResponse } from "../lib/userResponse.js";
import { ok } from "../lib/respond.js";

export const authRouter = Router();

const loginSchema = z
  .object({
    pin: z.string().regex(/^\d{4,6}$/).optional(),
    userId: z.string().uuid().optional(),
    username: z.string().min(2).max(64).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).optional(),
    terminalId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    const hasPin = !!v.pin;
    const hasPassword = !!v.password && (!!v.username || !!v.email);
    if (!hasPin && !hasPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide a PIN or a username/email with password" });
    }
  });

/** Increment the failure counter for the PIN path (existing behavior). */
async function registerFailure(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const attempts = user.failedPinAttempts + 1;
  const lock = attempts >= env.MAX_PIN_ATTEMPTS;
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedPinAttempts: lock ? 0 : attempts,
      lockoutUntil: lock ? new Date(Date.now() + env.LOCKOUT_MINUTES * 60_000) : user.lockoutUntil,
    },
  });
}

/** Password path uses its own thresholds but the same counter columns (§4.1). */
async function registerPasswordFailure(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const attempts = user.failedPinAttempts + 1;
  const lock = attempts >= env.MAX_PASSWORD_ATTEMPTS;
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedPinAttempts: lock ? 0 : attempts,
      lockoutUntil: lock ? new Date(Date.now() + env.PASSWORD_LOCKOUT_MINUTES * 60_000) : user.lockoutUntil,
    },
  });
}

authRouter.post(
  "/login",
  // Per-account lockout (5 attempts) is the brute-force defense; this per-IP
  // cap only shapes DoS traffic and must allow a busy shift's staff switching.
  rateLimit({ key: "login", windowMs: 60_000, max: 30 }),
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { pin, userId, username, email, password, terminalId } = req.body as z.infer<typeof loginSchema>;

    let user = null;

    if (pin) {
      // Existing PIN flow (unchanged).
      const candidates = userId
        ? await prisma.user.findMany({ where: { id: userId, isActive: true, deletedAt: null } })
        : await prisma.user.findMany({ where: { isActive: true, deletedAt: null, pinHash: { not: null } } });
      for (const c of candidates) {
        if (c.pinHash && (await verifyPin(pin, c.pinHash))) {
          user = c;
          break;
        }
      }
      if (!user) {
        if (userId) await registerFailure(userId);
        throw ApiError.unauthorized("Invalid PIN");
      }
    } else if (password && (username || email)) {
      // Username/email + password flow.
      const found = await prisma.user.findFirst({
        where: {
          OR: [
            ...(username ? [{ username }] : []),
            ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
          ],
        },
      });
      if (found?.lockoutUntil && found.lockoutUntil > new Date()) {
        const mins = Math.ceil((found.lockoutUntil.getTime() - Date.now()) / 60_000);
        throw new ApiError(423, "auth.login.locked", `Account locked for ${mins} more minute(s)`);
      }
      if (!found || !found.passwordHash || !(await verifyPassword(password, found.passwordHash))) {
        if (found) await registerPasswordFailure(found.id);
        throw new ApiError(401, "auth.login.failed", "Invalid username/email or password");
      }
      if (!found.isActive || found.deletedAt) {
        await audit({
          restaurantId: found.restaurantId,
          userId: found.id,
          action: "LOGIN_BLOCKED_INACTIVE",
          entityType: "User",
          entityId: found.id,
          ipAddress: clientIp(req),
        });
        throw new ApiError(403, "auth.login.inactive", "This account is deactivated");
      }
      user = found;
    } else {
      throw ApiError.badRequest("Provide a PIN or a username/email with password");
    }

    if (!user.isActive || user.deletedAt) {
      throw new ApiError(403, "auth.login.inactive", "This account is deactivated");
    }
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      const mins = Math.ceil((user.lockoutUntil.getTime() - Date.now()) / 60_000);
      throw new ApiError(423, "auth.login.locked", `Account locked for ${mins} more minute(s)`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedPinAttempts: 0, lockoutUntil: null, lastLoginAt: new Date() },
    });

    const { token, tokenHash } = newSessionToken();
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000);
    const session = await prisma.session.create({
      data: { tokenHash, userId: user.id, terminalId: terminalId ?? null, expiresAt },
    });

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: env.COOKIE_SECURE,
      maxAge: env.SESSION_TTL_HOURS * 3600_000,
      path: "/",
    });

    await audit({
      restaurantId: user.restaurantId,
      userId: user.id,
      action: "AUTH_LOGIN",
      entityType: "User",
      entityId: user.id,
      terminalId: terminalId ?? null,
      ipAddress: clientIp(req),
    });

    res.json({ user: toUserResponse(user), sessionId: session.id, token });
  }),
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const token =
      (req.cookies?.[SESSION_COOKIE] as string | undefined) ||
      (req.headers["x-session-token"] as string | undefined);
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => {});
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user || user.deletedAt) throw ApiError.unauthorized();
    res.json({ user: toUserResponse(user) });
  }),
);

// ── First-run setup (PRD platform §4.2–4.3) ─────────────────────────────────

authRouter.get(
  "/setup-status",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.count({ where: { deletedAt: null } });
    ok(res, { needsSetup: users === 0 }, "Setup status loaded");
  }),
);

const registerSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().max(32).optional(),
  restaurantName: z.string().min(1).max(80).optional(),
});

// Serialize concurrent first-admin registrations so only one can pass the
// empty-database check (PRD platform §4.3).
let setupChain: Promise<void> = Promise.resolve();

authRouter.post(
  "/register-first-admin",
  rateLimit({ key: "register", windowMs: 60_000, max: 5 }),
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const prev = setupChain;
    setupChain = prev.then(() => gate);
    await prev;
    try {
      const b = req.body as z.infer<typeof registerSchema>;

      const activeUsers = await prisma.user.count({ where: { deletedAt: null, isActive: true } });
      if (activeUsers > 0) {
        throw new ApiError(403, "auth.firstadmin.notallowed", "Setup already completed");
      }

      const email = b.email.toLowerCase();
      if (await prisma.user.findFirst({ where: { username: b.username, deletedAt: null }, select: { id: true } })) {
        throw new ApiError(409, "validation.duplicate.username", "That username is already taken");
      }
      if (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, deletedAt: null }, select: { id: true } })) {
        throw new ApiError(409, "validation.duplicate.email", "That email is already registered");
      }

      let restaurant = await prisma.restaurant.findFirst({ orderBy: { createdAt: "asc" } });
      if (!restaurant) {
        restaurant = await prisma.restaurant.create({
          data: {
            name: b.restaurantName ?? "My Restaurant",
            currency: env.DEFAULT_CURRENCY,
            taxRate: env.DEFAULT_TAX_RATE.toFixed(4),
            serviceChargePct: env.DEFAULT_SERVICE_CHARGE.toFixed(4),
            businessDayCutoff: env.DEFAULT_BUSINESS_DAY_CUTOFF,
          },
        });
      }

      const user = await prisma.user.create({
        data: {
          restaurantId: restaurant.id,
          name: `${b.firstName} ${b.lastName}`,
          username: b.username,
          firstName: b.firstName,
          lastName: b.lastName,
          phone: b.phone ?? null,
          email,
          role: "OWNER",
          isActive: true,
          passwordHash: await hashPassword(b.password),
          passwordChangedAt: new Date(),
        },
      });

      await audit({
        restaurantId: restaurant.id,
        userId: user.id,
        action: "USER_REGISTER",
        entityType: "User",
        entityId: user.id,
        after: { role: user.role },
        ipAddress: clientIp(req),
      });

      ok(res, { user: toUserResponse(user) }, "First admin registered", 201);
    } finally {
      release();
    }
  }),
);

// ── Password management (PRD platform §4.4) ─────────────────────────────────

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post(
  "/change-password",
  requireAuth,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw ApiError.unauthorized();
    if (!user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ApiError(403, "auth.current.password.incorrect", "Current password is incorrect");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
    });
    // Invalidate every other session, keep the current one.
    await prisma.session.deleteMany({
      where: { userId: user.id, ...(req.auth!.sessionId ? { id: { not: req.auth!.sessionId } } : {}) },
    });

    await audit({
      restaurantId: user.restaurantId,
      userId: user.id,
      action: "PASSWORD_CHANGE",
      entityType: "User",
      entityId: user.id,
      ipAddress: clientIp(req),
    });

    res.json({ success: true, message: "Password changed" });
  }),
);

// ── PIN management (existing endpoint, unchanged) ───────────────────────────

const changePinSchema = z.object({
  currentPin: z.string().regex(/^\d{4,6}$/).optional(),
  newPin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
});

authRouter.post(
  "/change-pin",
  requireAuth,
  validate({ body: changePinSchema }),
  asyncHandler(async (req, res) => {
    const { currentPin, newPin } = req.body as z.infer<typeof changePinSchema>;
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw ApiError.unauthorized();
    if (user.pinHash && (!currentPin || !(await verifyPin(currentPin, user.pinHash)))) {
      throw ApiError.forbidden("Current PIN is incorrect");
    }
    await prisma.user.update({ where: { id: user.id }, data: { pinHash: await hashPin(newPin) } });
    await audit({
      restaurantId: user.restaurantId,
      userId: user.id,
      action: "AUTH_PIN_CHANGED",
      entityType: "User",
      entityId: user.id,
      ipAddress: clientIp(req),
    });
    res.json({ ok: true });
  }),
);

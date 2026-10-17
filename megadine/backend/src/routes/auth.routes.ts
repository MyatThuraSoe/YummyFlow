import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { verifyPin, verifyPassword, newSessionToken, hashPin, hashToken } from "../lib/auth.js";
import { SESSION_COOKIE, requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { audit, clientIp } from "../lib/audit.js";
import { ROLE_CAPABILITIES } from "../lib/permissions.js";
import type { Role } from "@prisma/client";

export const authRouter = Router();

const loginSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  terminalId: z.string().uuid().optional(),
});

function publicUser(u: { id: string; name: string; email: string | null; role: Role; restaurantId: string }) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    restaurantId: u.restaurantId,
    capabilities: ROLE_CAPABILITIES[u.role] ?? [],
  };
}

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

authRouter.post(
  "/login",
  rateLimit({ key: "login", windowMs: 60_000, max: 10 }),
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { pin, userId, email, password, terminalId } = req.body as z.infer<typeof loginSchema>;

    let user = null;

    if (email && password) {
      user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
        if (user) await registerFailure(user.id);
        throw ApiError.unauthorized("Invalid email or password");
      }
    } else if (pin) {
      const candidates = userId
        ? await prisma.user.findMany({ where: { id: userId, isActive: true } })
        : await prisma.user.findMany({ where: { isActive: true, pinHash: { not: null } } });
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
    } else {
      throw ApiError.badRequest("Provide a PIN or email/password");
    }

    if (!user.isActive) throw ApiError.forbidden("This account is disabled");
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      const mins = Math.ceil((user.lockoutUntil.getTime() - Date.now()) / 60_000);
      throw ApiError.locked(`Account locked for ${mins} more minute(s)`);
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

    res.json({ user: publicUser(user), sessionId: session.id, token });
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
    if (!user) throw ApiError.unauthorized();
    res.json({ user: publicUser(user) });
  }),
);

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

import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { hashToken } from "../lib/auth.js";
import { env } from "../lib/env.js";
import { ApiError } from "../lib/errors.js";
import type { AuthContext } from "../types/express.js";
import type { Role } from "@prisma/client";

export const SESSION_COOKIE = "md_session";

export async function attachAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token =
      (req.cookies?.[SESSION_COOKIE] as string | undefined) ||
      (req.headers["x-session-token"] as string | undefined);
    if (!token) return next();

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return next();
    if (session.expiresAt < new Date()) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return next();
    }
    if (!session.user.isActive) return next();

    // Sliding renewal: extend when past the halfway mark.
    const now = Date.now();
    const remaining = session.expiresAt.getTime() - now;
    if (remaining < (env.SESSION_TTL_HOURS * 3600_000) / 2) {
      const expiresAt = new Date(now + env.SESSION_TTL_HOURS * 3600_000);
      await prisma.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date(), expiresAt } })
        .catch(() => {});
    }

    req.auth = {
      userId: session.userId,
      role: session.user.role as Role,
      restaurantId: session.user.restaurantId,
      name: session.user.name,
      sessionId: session.id,
      terminalId: session.terminalId,
    } satisfies AuthContext;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(ApiError.unauthorized());
  next();
}

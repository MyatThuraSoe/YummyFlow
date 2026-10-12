import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../lib/errors.js";

interface Bucket {
  count: number;
  resetAt: number;
}

/** Tiny in-memory sliding-window limiter (per IP + key). LAN-scale only. */
export function rateLimit(opts: { windowMs: number; max: number; key?: string }) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max, key = "rl" } = opts;

  return (req: Request, _res: Response, next: NextFunction) => {
    const id = `${key}:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const b = buckets.get(id);
    if (!b || b.resetAt < now) {
      buckets.set(id, { count: 1, resetAt: now + windowMs });
      return next();
    }
    b.count += 1;
    if (b.count > max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      _res.setHeader("Retry-After", String(retry));
      return next(ApiError.tooMany(`Too many attempts. Try again in ${retry}s.`));
    }
    next();
  };
}

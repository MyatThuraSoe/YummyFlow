import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../lib/errors.js";
import { resolveCapabilities, type Capability } from "../lib/permissions.js";

/** Enforce a capability from the role matrix (PRD Appendix B). */
export function requirePermission(capability: Capability) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) return next(ApiError.unauthorized());
      const effective = await resolveCapabilities(req.auth.userId, req.auth.role);
      if (!effective.includes(capability)) {
        return next(ApiError.forbidden(`Role ${req.auth.role} lacks capability ${capability}`));
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

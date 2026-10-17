import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../lib/errors.js";
import { can, type Capability } from "../lib/permissions.js";

/** Enforce a capability from the role matrix (PRD Appendix B). */
export function requirePermission(capability: Capability) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(ApiError.unauthorized());
    if (!can(req.auth.role, capability)) {
      return next(ApiError.forbidden(`Role ${req.auth.role} lacks capability ${capability}`));
    }
    next();
  };
}

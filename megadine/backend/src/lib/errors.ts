import type { Request, Response, NextFunction, RequestHandler } from "express";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(msg = "Bad request", details?: unknown) {
    return new ApiError(400, "BAD_REQUEST", msg, details);
  }
  static unauthorized(msg = "Not authenticated") {
    return new ApiError(401, "UNAUTHORIZED", msg);
  }
  static forbidden(msg = "You do not have permission for this action") {
    return new ApiError(403, "FORBIDDEN", msg);
  }
  static notFound(msg = "Not found") {
    return new ApiError(404, "NOT_FOUND", msg);
  }
  static conflict(msg = "Conflict") {
    return new ApiError(409, "CONFLICT", msg);
  }
  static tooMany(msg = "Too many requests") {
    return new ApiError(429, "RATE_LIMITED", msg);
  }
  static locked(msg = "Account locked") {
    return new ApiError(423, "LOCKED", msg);
  }
}

/** Wrap async route handlers so rejections reach the error middleware. */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

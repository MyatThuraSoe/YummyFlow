import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../lib/errors.js";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  // Prisma unique-constraint style errors -> 409
  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === "P2002") {
    return res
      .status(409)
      .json({ error: { code: "CONFLICT", message: "A record with these details already exists" } });
  }
  if (anyErr?.code === "P2025") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Record not found" } });
  }
  console.error("[error]", err);
  res.status(500).json({
    error: { code: "INTERNAL", message: anyErr?.message ?? "Internal server error" },
  });
}

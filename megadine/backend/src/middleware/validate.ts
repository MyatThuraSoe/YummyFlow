import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";
import { ApiError } from "../lib/errors.js";

/** Validate body (and optionally query/params) with a Zod schema. */
export function validate(schema: { body?: ZodType; query?: ZodType; params?: ZodType }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) req.validated = { ...(req.validated ?? { body: undefined, query: undefined, params: undefined }), query: schema.query.parse(req.query) } as never;
      if (schema.params) req.params = schema.params.parse(req.params) as never;
      next();
    } catch (err) {
      const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      next(
        ApiError.badRequest(
          issues?.[0]?.message ?? "Invalid request payload",
          issues?.map((i) => ({ path: i.path.join("."), message: i.message })),
        ),
      );
    }
  };
}

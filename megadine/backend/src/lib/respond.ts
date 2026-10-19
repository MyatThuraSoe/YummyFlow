import type { Response } from "express";

/** Standard envelope for new platform endpoints (PRD §4.6). */
export interface Envelope<T> {
  success: true;
  message: string;
  data: T;
}

export function ok<T>(res: Response, data: T, message = "OK", status = 200): void {
  res.status(status).json({ success: true, message, data } satisfies Envelope<T>);
}

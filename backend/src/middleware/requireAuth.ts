import type { Request, Response, NextFunction } from "express";
import { auth } from "../lib/auth";
// import { allPermissons } from "../lib/permissions";
import { fromNodeHeaders } from "better-auth/node";
import { activitiesLog } from "../lib/activities-log";

/**
 * Simple Auth Middleware
 * Ensures the user is signed in. Does NOT check for specific roles.
 * Use this for general protected routes (e.g., viewing personal profile, placing a standard order). as well as include user object in the request for further use in controllers
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session || !session.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    // Attach user and session to request for downstream use
    (req as any).user = session.user;
    (req as any).session = session.session;

    return next();
  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(401).json({ message: "Unauthorized" });
  }
};

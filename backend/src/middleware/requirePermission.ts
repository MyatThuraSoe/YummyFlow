import type { Request, Response, NextFunction } from "express";
import { auth } from "../lib/auth";
import { allPermissions } from "../lib/permissions";
import { fromNodeHeaders } from "better-auth/node";
import { activitiesLog } from "../lib/activities-log";

// resources: category, menu, order, table, kds, report, user, session
const resources = [
  "category",
  "menu",
  "order",
  "table",
  "reservation",
  "kds",
  "report",
  "user",
  "session",
] as const;

export const requirePermission = (
  action: (typeof allPermissions)[number],
  resource: (typeof resources)[number],
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 1. Get Session
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (!session || !session.user) {
        return res.status(401).json({ error: "Unauthorized: Please log in." });
      }

      // 2. Check Permission
      const permissionResponse = await auth.api.userHasPermission({
        headers: fromNodeHeaders(req.headers),
        body: {
          userId: session.user.id,
          permissions: {
            [resource]: [action],
          },
        },
      });

      // error
      if (permissionResponse.error) {
        console.error("Permission check error:", permissionResponse.error);
        return res.status(500).json({ error: "Internal Server Error" });
      }

      // success or not allowed
      if (permissionResponse.success) {
        (req as any).user = session.user;
        (req as any).session = session.session;
        return next();
      } else {
        await activitiesLog({
          userId: session.user.id,
          action: `${resource}:${action} permission denied`,
          details: `Permission denied for user ${session.user.id} on ${resource}:${action}`,
        });
        console.error(
          `Permission denied for user ${session.user.id} on ${resource}:${action}`,
        );
        res.status(403).json({
          error: `Forbidden: Missing '${action}' permission on '${resource}'`,
        });
      }
    } catch (error) {
      console.error("Error in requirePermission middleware:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };
};

import type { Role } from "@prisma/client";
import { prisma } from "./prisma.js";
import { ApiError } from "./errors.js";

/** Roles protected by the last-admin guards (PRD platform §5.2). */
export const ADMIN_GUARD_ROLES: Role[] = ["OWNER", "ADMIN"];

/**
 * Free a unique handle (username/email) when a user is soft-deleted so a
 * future account can reuse it (PRD platform §5.3).
 */
export function releaseUnique(value: string | null, id: string, maxLen = 255): string | null {
  if (!value) return value;
  const suffix = `#del-${id.slice(0, 8)}`;
  const keep = Math.max(0, maxLen - suffix.length);
  return value.slice(0, keep) + suffix;
}

export type GuardAction = "demote" | "deactivate" | "delete";

const GUARD_CODES: Record<GuardAction, string> = {
  demote: "auth.lastadmin.demote",
  deactivate: "auth.lastadmin.deactivate",
  delete: "auth.lastadmin.delete",
};

/**
 * Throws 409 when the target user is an admin-guard role and there is no
 * other active, non-deleted admin-guard user in the restaurant.
 */
export async function assertNotLastAdmin(restaurantId: string, userId: string, action: GuardAction): Promise<void> {
  const target = await prisma.user.findFirst({ where: { id: userId, restaurantId, deletedAt: null } });
  if (!target) throw ApiError.notFound("User not found");
  if (!ADMIN_GUARD_ROLES.includes(target.role)) return;

  const others = await prisma.user.count({
    where: {
      restaurantId,
      deletedAt: null,
      isActive: true,
      role: { in: ADMIN_GUARD_ROLES },
      id: { not: userId },
    },
  });
  if (others === 0) {
    throw new ApiError(409, GUARD_CODES[action], `Cannot ${action} the last admin account`);
  }
}

/** Throws 409 when a user tries to deactivate/delete their own account. */
export function assertNotSelfDeactivate(actorId: string, targetId: string): void {
  if (actorId === targetId) {
    throw new ApiError(409, "auth.user.self.deactivate", "You cannot deactivate your own account");
  }
}

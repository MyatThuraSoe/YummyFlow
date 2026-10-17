import { prisma } from "./prisma.js";
import { verifyPin } from "./auth.js";
import { MANAGER_ROLES } from "./permissions.js";
import { ApiError } from "./errors.js";

/**
 * Verify a manager (OWNER/ADMIN) PIN for an elevated action such as a void,
 * refund or large discount. The check happens server-side against the stored
 * hash; the client cannot spoof an approval token.
 */
export async function verifyManagerPin(restaurantId: string, pin: string, requestedBy: string) {
  if (!pin) throw ApiError.badRequest("Manager PIN is required for this action");
  const managers = await prisma.user.findMany({
    where: { restaurantId, isActive: true, role: { in: MANAGER_ROLES }, pinHash: { not: null } },
    select: { id: true, name: true, role: true, pinHash: true },
  });
  for (const m of managers) {
    if (m.pinHash && (await verifyPin(pin, m.pinHash))) {
      if (m.id === requestedBy) throw ApiError.forbidden("A manager other than the requester must approve");
      return { id: m.id, name: m.name };
    }
  }
  throw ApiError.forbidden("Invalid manager PIN");
}

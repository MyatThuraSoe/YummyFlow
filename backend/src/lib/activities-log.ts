import { prisma } from "./prisma";

/**
 * Record an operational event in the staff-only audit trail.
 *
 * `userId` is optional because a few call sites cannot prove an actor, and
 * `activitiesLog.userId` is a *required* relation in the schema — so Prisma
 * rejects `undefined`. That rejection used to be swallowed by the catch below,
 * which meant a missing actor silently produced no audit row whatsoever: the
 * event simply vanished from the record that exists to prove it happened. The
 * skip is now explicit and warns, so the gap is visible instead of invisible.
 */
export const activitiesLog = async ({
  action,
  userId,
  details,
}: {
  userId?: string;
  action: string;
  details?: string;
}) => {
  if (!userId) {
    console.warn(
      `[activitiesLog] Skipping "${action}" — no actor id available to attribute this event to.`,
    );
    return;
  }

  try {
    await prisma.activitiesLog.create({
      data: { userId, action, details },
    });
  } catch (error) {
    console.error("Error logging activity:", error);
  }
};

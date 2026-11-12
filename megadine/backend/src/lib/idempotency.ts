import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

interface RequestContext {
  restaurantId: string;
  action: string;
  requestId?: string | null;
}

/**
 * Run `work` at most once for a client request id. A retry after a dropped
 * response (the classic double-tap / flaky Wi-Fi case) replays the stored
 * result instead of adding the items or sending the ticket a second time.
 *
 * The stored JSON is the same shape Express would send, so a replayed response
 * is indistinguishable from the original.
 */
export async function withRequestIdempotency<T>(
  ctx: RequestContext,
  work: () => Promise<T>,
): Promise<{ replayed: boolean; result: T }> {
  const requestId = ctx.requestId?.trim();
  if (!requestId) return { replayed: false, result: await work() };

  const key = { restaurantId: ctx.restaurantId, action: ctx.action, requestId };
  const existing = await prisma.requestLog.findUnique({
    where: { restaurantId_action_requestId: key },
  });
  if (existing?.resultJson) return { replayed: true, result: existing.resultJson as T };

  const result = await work();
  try {
    await prisma.requestLog.create({
      data: { ...key, resultJson: result as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // A concurrent retry stored its result first; prefer it.
    const winner = await prisma.requestLog.findUnique({
      where: { restaurantId_action_requestId: key },
    });
    if (winner?.resultJson) return { replayed: true, result: winner.resultJson as T };
  }
  return { replayed: false, result };
}

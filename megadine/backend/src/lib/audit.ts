import { prisma } from "./prisma.js";

export interface AuditInput {
  restaurantId: string;
  userId: string;
  orderId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvedBy?: string | null;
  terminalId?: string | null;
  ipAddress?: string | null;
}

/** Append-only audit trail (PRD §9). Never throws into the request path. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        restaurantId: input.restaurantId,
        userId: input.userId,
        orderId: input.orderId ?? undefined,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: (input.before ?? undefined) as never,
        after: (input.after ?? undefined) as never,
        reason: input.reason ?? undefined,
        approvedBy: input.approvedBy ?? undefined,
        terminalId: input.terminalId ?? undefined,
        ipAddress: input.ipAddress ?? undefined,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write entry", err);
  }
}

export function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0]?.trim() ?? "";
  return req.ip ?? "";
}

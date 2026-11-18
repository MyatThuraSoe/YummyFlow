import { prisma } from "./prisma.js";
import { verifyPin } from "./auth.js";
import { MANAGER_ROLES, resolveCapabilities, can, type Capability } from "./permissions.js";
import { ApiError } from "./errors.js";
import type { Role } from "@prisma/client";

/**
 * Verify a manager PIN for an elevated action such as a void, refund or large
 * discount. When the screen taps a named approver the PIN is checked against
 * that person only, so the audit row always names the real approver.
 */
export async function verifyManagerPin(
  restaurantId: string,
  pin: string,
  requestedBy: string,
  approverId?: string | null,
  action?: ApprovalAction,
  amount?: number | null,
) {
  if (!pin) throw ApiError.badRequest("Manager PIN is required for this action");

  async function accept(approver: { id: string; name: string; role: Role }) {
    if (action) await assertWithinApprovalLimit(approver.role, action, amount);
    return { id: approver.id, name: approver.name, role: approver.role };
  }

  if (approverId) {
    const approver = await prisma.user.findFirst({
      where: { id: approverId, restaurantId, isActive: true, deletedAt: null, pinHash: { not: null } },
      select: { id: true, name: true, role: true, pinHash: true },
    });
    if (!approver?.pinHash || !(await verifyPin(pin, approver.pinHash))) {
      throw ApiError.forbidden("Invalid manager PIN");
    }
    if (approver.id === requestedBy) throw ApiError.forbidden("A manager other than the requester must approve");
    const caps = await resolveCapabilities(approver.id, approver.role as Role);
    if (!caps.includes("approve.override")) throw ApiError.forbidden("This person cannot approve overrides");
    return accept({ id: approver.id, name: approver.name, role: approver.role as Role });
  }

  const managers = await prisma.user.findMany({
    where: { restaurantId, isActive: true, deletedAt: null, role: { in: MANAGER_ROLES }, pinHash: { not: null } },
    select: { id: true, name: true, role: true, pinHash: true },
  });
  for (const m of managers) {
    if (m.pinHash && (await verifyPin(pin, m.pinHash))) {
      if (m.id === requestedBy) throw ApiError.forbidden("A manager other than the requester must approve");
      const caps = await resolveCapabilities(m.id, m.role as Role);
      if (!caps.includes("approve.override")) continue;
      return accept({ id: m.id, name: m.name, role: m.role as Role });
    }
  }
  throw ApiError.forbidden("Invalid manager PIN");
}

export type ApprovalAction = "DISCOUNT" | "VOID" | "REFUND" | "COMP" | "PRIORITY";

/** Per-role limit in major units, or null when no row means unlimited. */
export async function approvalLimitFor(role: Role, action: ApprovalAction): Promise<number | null> {
  const row = await prisma.approvalLimit.findUnique({
    where: { role_action: { role, action } },
    select: { maxAmount: true },
  }).catch(() => null);
  return row?.maxAmount == null ? null : Number(row.maxAmount);
}

/** Throws when an override exceeds the approver's per-role limit. */
export async function assertWithinApprovalLimit(role: Role, action: ApprovalAction, amount: number | null | undefined) {
  if (amount == null) return;
  const limit = await approvalLimitFor(role, action);
  if (limit != null && amount > limit) {
    throw ApiError.forbidden(`This approval exceeds the ${role} limit of ${limit}`);
  }
}

export async function createApprovalRequest(input: {
  restaurantId: string;
  requesterId: string;
  action: ApprovalAction;
  amount?: number | null;
  reason?: string | null;
  payload?: unknown;
}) {
  return prisma.approvalRequest.create({
    data: {
      restaurantId: input.restaurantId,
      requesterId: input.requesterId,
      action: input.action,
      amount: input.amount ?? null,
      reason: input.reason ?? null,
      payload: (input.payload ?? undefined) as never,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
}

export async function decideApprovalRequest(input: {
  id: string;
  restaurantId: string;
  approverId: string;
  approverRole: Role;
  approve: boolean;
}) {
  const caps = await resolveCapabilities(input.approverId, input.approverRole);
  if (!caps.includes("approve.override")) throw ApiError.forbidden("You cannot approve overrides");

  const request = await prisma.approvalRequest.findFirst({
    where: { id: input.id, restaurantId: input.restaurantId },
  });
  if (!request) throw ApiError.notFound("Approval request not found");
  if (request.status !== "PENDING") throw ApiError.conflict("This request was already decided");
  if (request.expiresAt && request.expiresAt < new Date()) {
    await prisma.approvalRequest.update({ where: { id: request.id }, data: { status: "EXPIRED" } });
    throw ApiError.conflict("This request expired");
  }
  if (request.requesterId === input.approverId) {
    throw ApiError.forbidden("The requester cannot approve their own request");
  }
  if (input.approve) {
    await assertWithinApprovalLimit(input.approverRole, request.action as ApprovalAction, request.amount ? Number(request.amount) : null);
  }
  return prisma.approvalRequest.update({
    where: { id: request.id },
    data: {
      status: input.approve ? "APPROVED" : "REFUSED",
      approverId: input.approverId,
      decidedAt: new Date(),
    },
  });
}

/**
 * Attach a granted queue approval to the action it authorised. The atomic
 * update makes a request single-use, so a second submit cannot reuse it.
 */
export async function consumeApproval(input: {
  id: string;
  restaurantId: string;
  requesterId: string;
  action: ApprovalAction;
  amount?: number | null;
}) {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: input.id, restaurantId: input.restaurantId },
  });
  if (!request) throw ApiError.notFound("Approval request not found");
  if (request.requesterId !== input.requesterId) {
    throw ApiError.forbidden("This approval belongs to a different user");
  }
  if (request.action !== input.action) throw ApiError.badRequest("Approval action does not match this action");
  if (request.status !== "APPROVED") throw ApiError.forbidden("That request has not been approved");
  if (request.expiresAt && request.expiresAt < new Date()) throw ApiError.conflict("That approval has expired");
  if (
    input.amount != null &&
    request.amount != null &&
    Math.abs(Number(request.amount) - input.amount) > 0.01
  ) {
    throw ApiError.badRequest("Approval amount does not match this action");
  }
  const claimed = await prisma.approvalRequest.updateMany({
    where: { id: request.id, status: "APPROVED", consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) throw ApiError.conflict("That approval was already used");
  return request;
}

/** Kept so older imports keep compiling; routes should use resolveCapabilities. */
export function roleCanApprove(role: Role): boolean {
  return can(role, "approve.override" as Capability);
}

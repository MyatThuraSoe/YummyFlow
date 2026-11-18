import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit, clientIp } from "../lib/audit.js";
import { ok } from "../lib/respond.js";
import { createApprovalRequest, decideApprovalRequest, type ApprovalAction } from "../lib/approval.js";
import type { Role } from "@prisma/client";

export const approvalsRouter = Router();
approvalsRouter.use(requireAuth);

/**
 * "Ask manager": a floor device posts the override it needs, and an approver
 * on another device taps approve or refuse. The PIN never crosses the floor.
 */
approvalsRouter.post(
  "/",
  validate({
    body: z.object({
      action: z.enum(["DISCOUNT", "VOID", "REFUND", "COMP", "PRIORITY"]),
      amount: z.number().nonnegative().optional().nullable(),
      reason: z.string().max(300).optional().nullable(),
      payload: z.unknown().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const b = req.body as { action: ApprovalAction; amount?: number | null; reason?: string | null; payload?: unknown };
    const request = await createApprovalRequest({
      restaurantId: req.auth!.restaurantId,
      requesterId: req.auth!.userId,
      action: b.action,
      amount: b.amount ?? null,
      reason: b.reason ?? null,
      payload: b.payload,
    });
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "APPROVAL_REQUESTED",
      entityType: "ApprovalRequest",
      entityId: request.id,
      after: { action: b.action, amount: b.amount ?? null },
      reason: b.reason ?? null,
      terminalId: req.auth!.terminalId,
      ipAddress: clientIp(req),
    });
    ok(res, { request }, "Approval requested", 201);
  }),
);

approvalsRouter.get(
  "/",
  requirePermission("approve.override"),
  asyncHandler(async (req, res) => {
    const status = String(req.query.status ?? "PENDING");
    const requests = await prisma.approvalRequest.findMany({
      where: {
        restaurantId: req.auth!.restaurantId,
        ...(status === "ALL" ? {} : { status }),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        requester: { select: { id: true, name: true, role: true } },
        approver: { select: { id: true, name: true } },
      },
    });
    ok(res, { requests }, "Approval requests loaded");
  }),
);

approvalsRouter.get(
  "/mine",
  asyncHandler(async (req, res) => {
    const requests = await prisma.approvalRequest.findMany({
      where: { restaurantId: req.auth!.restaurantId, requesterId: req.auth!.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    ok(res, { requests }, "My approval requests loaded");
  }),
);

approvalsRouter.post(
  "/:id/decide",
  requirePermission("approve.override"),
  validate({ body: z.object({ approve: z.boolean(), reason: z.string().max(300).optional().nullable() }) }),
  asyncHandler(async (req, res) => {
    const b = req.body as { approve: boolean; reason?: string | null };
    const request = await decideApprovalRequest({
      id: String(req.params.id),
      restaurantId: req.auth!.restaurantId,
      approverId: req.auth!.userId,
      approverRole: req.auth!.role as Role,
      approve: b.approve,
    });
    await audit({
      restaurantId: request.restaurantId,
      userId: request.requesterId,
      action: b.approve ? "APPROVAL_GRANTED" : "APPROVAL_REFUSED",
      entityType: "ApprovalRequest",
      entityId: request.id,
      after: { action: request.action, amount: request.amount ? Number(request.amount) : null },
      reason: b.reason ?? null,
      approvedBy: req.auth!.userId,
      terminalId: req.auth!.terminalId,
      ipAddress: clientIp(req),
    });
    ok(res, { request }, b.approve ? "Request approved" : "Request refused");
  }),
);

approvalsRouter.get(
  "/limits",
  requirePermission("approve.override"),
  asyncHandler(async (_req, res) => {
    const limits = await prisma.approvalLimit.findMany({ orderBy: [{ role: "asc" }, { action: "asc" }] });
    ok(res, { limits }, "Approval limits loaded");
  }),
);

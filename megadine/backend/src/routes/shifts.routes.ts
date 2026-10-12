import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { addCashMovement, closeShift, currentOpenShift, openShift, shiftSummary } from "../services/shift.service.js";
import { fromCents, toCents } from "../lib/money.js";

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth);

shiftsRouter.get(
  "/current",
  asyncHandler(async (req, res) => {
    const { terminalId } = req.query as { terminalId?: string };
    const shift = await currentOpenShift(req.auth!.restaurantId, req.auth!.userId, terminalId ?? null);
    if (!shift) {
      res.json({ shift: null });
      return;
    }
    const summary = await shiftSummary(shift.id);
    res.json({ shift, summary: { ...summary, shift: undefined } });
  }),
);

shiftsRouter.get(
  "/",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const shifts = await prisma.cashShift.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      orderBy: { openedAt: "desc" },
      take: 50,
      include: { cashier: { select: { name: true } } },
    });
    res.json({ shifts });
  }),
);

const openSchema = z.object({
  openingFloat: z.number().nonnegative(),
  terminalId: z.string().uuid().nullable().optional(),
});

shiftsRouter.post(
  "/open",
  requirePermission("shift.open"),
  validate({ body: openSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof openSchema>;
    const shift = await openShift({
      restaurantId: req.auth!.restaurantId,
      cashierId: req.auth!.userId,
      terminalId: body.terminalId ?? null,
      openingFloat: toCents(body.openingFloat),
    });
    res.status(201).json({ shift });
  }),
);

const movementSchema = z.object({
  type: z.enum(["PAID_IN", "PAID_OUT", "SAFE_DROP"]),
  amount: z.number().positive(),
  reason: z.string().optional(),
});

shiftsRouter.post(
  "/:id/movements",
  requirePermission("shift.open"),
  validate({ body: movementSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof movementSchema>;
    const movement = await addCashMovement({
      shiftId: String(req.params.id),
      actorId: req.auth!.userId,
      type: body.type,
      amount: toCents(body.amount),
      reason: body.reason,
    });
    res.status(201).json({ movement });
  }),
);

shiftsRouter.get(
  "/:id/x-report",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const summary = await shiftSummary(String(req.params.id));
    res.json({ report: summary });
  }),
);

const closeSchema = z.object({
  actualCash: z.number().nonnegative(),
  notes: z.string().optional(),
});

shiftsRouter.post(
  "/:id/close",
  requirePermission("shift.close"),
  validate({ body: closeSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof closeSchema>;
    const result = await closeShift({
      shiftId: String(req.params.id),
      actorId: req.auth!.userId,
      actualCash: toCents(body.actualCash),
      notes: body.notes,
    });
    res.json({
      shift: result.shift,
      variance: fromCents(result.variance),
      summary: { ...result.summary, shift: undefined },
    });
  }),
);

shiftsRouter.get(
  "/:id/z-report",
  requirePermission("report.z"),
  asyncHandler(async (req, res) => {
    const summary = await shiftSummary(String(req.params.id));
    res.json({ report: summary });
  }),
);

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { addCashMovement, closeShift, currentOpenShift, openShift, shiftSummary } from "../services/shift.service.js";
import { fromCents, toCents } from "../lib/money.js";
import { businessDateFor } from "../lib/businessDay.js";
import { audit } from "../lib/audit.js";

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

/**
 * Handover notes are operational, not pay data: any signed-in device can read
 * them so the next shift sees what ran out or broke. Only a closer/manager may
 * write one, and every write is audited.
 */
shiftsRouter.get(
  "/handover",
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const notes = await prisma.handoverNote.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: { author: { select: { id: true, name: true } } },
    });
    res.json({ notes });
  }),
);

const handoverSchema = z.object({
  shiftId: z.string().uuid().nullable().optional(),
  businessDate: z.string().datetime().nullable().optional(),
  ranOut: z.string().max(2000).nullable().optional(),
  broke: z.string().max(2000).nullable().optional(),
  late: z.string().max(2000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

shiftsRouter.post(
  "/handover",
  requirePermission("shift.close"),
  validate({ body: handoverSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof handoverSchema>;
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.auth!.restaurantId },
      select: { businessDayCutoff: true, timezone: true },
    });
    const businessDate = body.businessDate
      ? new Date(body.businessDate)
      : businessDateFor(new Date(), restaurant?.businessDayCutoff ?? "04:00", restaurant?.timezone);
    const note = await prisma.handoverNote.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        authorId: req.auth!.userId,
        shiftId: body.shiftId ?? null,
        businessDate,
        ranOut: body.ranOut || null,
        broke: body.broke || null,
        late: body.late || null,
        notes: body.notes || null,
      },
      include: { author: { select: { id: true, name: true } } },
    });
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "HANDOVER_NOTE_CREATED",
      entityType: "HandoverNote",
      entityId: note.id,
      after: { businessDate: businessDate.toISOString(), shiftId: note.shiftId },
    });
    res.status(201).json({ note });
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
  "/:id/movements",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const movements = await prisma.cashMovement.findMany({
      where: { shiftId: String(req.params.id) },
      orderBy: { createdAt: "asc" },
    });
    res.json({ movements });
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
      varianceTolerance: result.varianceTolerance,
      varianceExceedsTolerance: result.varianceExceedsTolerance,
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

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import {
  cancelReservation,
  createReservation,
  listReservations,
  markReservationNoShow,
  seatReservation,
  updateReservation,
} from "../services/reservation.service.js";

export const reservationsRouter = Router();
reservationsRouter.use(requireAuth);

reservationsRouter.get(
  "/",
  requirePermission("table.manage"),
  asyncHandler(async (req, res) => {
    const { from, to, tableId, status } = req.query as Record<string, string | undefined>;
    const reservations = await listReservations(req.auth!.restaurantId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      tableId,
      status: status as never,
    });
    res.json({ reservations });
  }),
);

const createSchema = z.object({
  tableId: z.string().uuid(),
  customerName: z.string().min(1).max(60),
  customerPhone: z.string().max(30).nullable().optional(),
  partySize: z.number().int().min(1).max(50),
  reservationTime: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  notes: z.string().max(300).nullable().optional(),
});

reservationsRouter.post(
  "/",
  requirePermission("table.manage"),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const reservation = await createReservation(req.auth!.restaurantId, req.auth!.userId, {
      tableId: body.tableId,
      customerName: body.customerName,
      customerPhone: body.customerPhone ?? null,
      partySize: body.partySize,
      reservationTime: new Date(body.reservationTime),
      durationMinutes: body.durationMinutes,
      notes: body.notes ?? null,
    });
    res.status(201).json({ reservation });
  }),
);

reservationsRouter.patch(
  "/:id",
  requirePermission("table.manage"),
  validate({ body: createSchema.partial() }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<ReturnType<typeof createSchema.partial>>;
    const reservation = await updateReservation(String(req.params.id), req.auth!.restaurantId, req.auth!.userId, {
      ...body,
      reservationTime: body.reservationTime ? new Date(body.reservationTime) : undefined,
    });
    res.json({ reservation });
  }),
);

reservationsRouter.post(
  "/:id/seat",
  requirePermission("table.manage"),
  asyncHandler(async (req, res) => {
    const reservation = await seatReservation(String(req.params.id), req.auth!.restaurantId, req.auth!.userId);
    res.json({ reservation });
  }),
);

reservationsRouter.post(
  "/:id/no-show",
  requirePermission("table.manage"),
  asyncHandler(async (req, res) => {
    const reservation = await markReservationNoShow(String(req.params.id), req.auth!.restaurantId, req.auth!.userId);
    res.json({ reservation });
  }),
);

reservationsRouter.post(
  "/:id/cancel",
  requirePermission("table.manage"),
  asyncHandler(async (req, res) => {
    const reservation = await cancelReservation(String(req.params.id), req.auth!.restaurantId, req.auth!.userId);
    res.json({ reservation });
  }),
);

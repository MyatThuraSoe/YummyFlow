import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { payOrder, refundOrder } from "../services/payment.service.js";

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const paySchema = z.object({
  orderId: z.string().uuid(),
  shiftId: z.string().uuid().nullable().optional(),
  terminalId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().max(120).nullable().optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(["CASH", "CARD", "MOBILE"]),
        amount: z.number().positive(),
        reference: z.string().max(120).nullable().optional(),
        cashReceived: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});

paymentsRouter.post(
  "/",
  requirePermission("pos.use"),
  validate({ body: paySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof paySchema>;
    const result = await payOrder({
      orderId: body.orderId,
      actorId: req.auth!.userId,
      shiftId: body.shiftId ?? null,
      terminalId: body.terminalId ?? null,
      payments: body.payments,
      idempotencyKey: body.idempotencyKey ?? null,
    });
    res.status(201).json({ order: result });
  }),
);

const refundSchema = z.object({
  orderId: z.string().uuid(),
  amount: z.number().positive(),
  reason: z.string().min(2),
  managerPin: z.string().regex(/^\d{4,6}$/),
  restock: z.boolean().optional(),
});

paymentsRouter.post(
  "/refund",
  requirePermission("order.refund"),
  validate({ body: refundSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof refundSchema>;
    const order = await refundOrder({
      orderId: body.orderId,
      actorId: req.auth!.userId,
      amount: body.amount,
      reason: body.reason,
      managerPin: body.managerPin,
      restock: body.restock,
    });
    res.json({ order });
  }),
);

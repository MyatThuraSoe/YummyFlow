import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { listTickets, toggleItemAvailability, updateTicketStatus } from "../services/kitchen.service.js";

export const kitchenRouter = Router();
kitchenRouter.use(requireAuth);
kitchenRouter.use(requirePermission("kds.view"));

type Station = "GRILL" | "FRYER" | "SALAD" | "BAR" | "DESSERT" | "KITCHEN";
const statusEnum = z.enum(["QUEUED", "PREPARING", "READY", "SERVED", "CANCELLED"]);

kitchenRouter.get(
  "/tickets",
  asyncHandler(async (req, res) => {
    const { station, active } = req.query as Record<string, string | undefined>;
    const tickets = await listTickets(req.auth!.restaurantId, {
      station: station ? (station as Station) : undefined,
      active: active !== "false",
    });
    res.json({ tickets });
  }),
);

const statusSchema = z.object({ status: statusEnum, reason: z.string().min(2).max(300).optional() });

kitchenRouter.post(
  "/tickets/:id/status",
  requirePermission("kds.update"),
  validate({ body: statusSchema }),
  asyncHandler(async (req, res) => {
    const { status, reason } = req.body as z.infer<typeof statusSchema>;
    const ticket = await updateTicketStatus(String(req.params.id), status, req.auth!.userId, reason);
    res.json({ ticket });
  }),
);

const toggleSchema = z.object({ isAvailable: z.boolean(), reason: z.string().optional() });

kitchenRouter.post(
  "/items/:id/availability",
  requirePermission("kds.update"),
  validate({ body: toggleSchema }),
  asyncHandler(async (req, res) => {
    const { isAvailable, reason } = req.body as z.infer<typeof toggleSchema>;
    const item = await toggleItemAvailability(String(req.params.id), isAvailable, req.auth!.userId, reason);
    res.json({ item });
  }),
);

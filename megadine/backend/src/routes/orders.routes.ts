import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit } from "../lib/audit.js";
import { sendToPrinter } from "../lib/printers.js";
import { env } from "../lib/env.js";
import {
  addItemsToOrder,
  applyDiscount,
  cancelOrder,
  createOrder,
  sendToKitchen,
  voidOrderLine,
} from "../services/order.service.js";
import { receiptTextForOrder } from "../services/receipt.service.js";

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const lineSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  variantId: z.string().uuid().nullable().optional(),
  modifierOptionIds: z.array(z.string().uuid()).optional(),
  notes: z.string().max(200).nullable().optional(),
  lineDiscount: z.number().nonnegative().optional(),
});

const createSchema = z.object({
  channel: z.enum(["DINE_IN", "TAKEAWAY", "PARCEL"]),
  tableId: z.string().uuid().nullable().optional(),
  terminalId: z.string().uuid().nullable().optional(),
  shiftId: z.string().uuid().nullable().optional(),
  items: z.array(lineSchema).min(1),
  orderDiscount: z.number().nonnegative().optional(),
  pickupName: z.string().max(60).nullable().optional(),
  pickupTime: z.string().datetime().nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
  idempotencyKey: z.string().max(120).nullable().optional(),
});

ordersRouter.post(
  "/",
  requirePermission("pos.use"),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const order = await createOrder({
      restaurantId: req.auth!.restaurantId,
      actorId: req.auth!.userId,
      channel: body.channel,
      tableId: body.tableId ?? null,
      terminalId: body.terminalId ?? null,
      shiftId: body.shiftId ?? null,
      items: body.items,
      orderDiscount: body.orderDiscount,
      pickupName: body.pickupName ?? null,
      pickupTime: body.pickupTime ? new Date(body.pickupTime) : null,
      notes: body.notes ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
    });
    res.status(201).json({ order });
  }),
);

ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, channel, tableId, businessDate, cashierId, limit } = req.query as Record<string, string | undefined>;
    const orders = await prisma.order.findMany({
      where: {
        restaurantId: req.auth!.restaurantId,
        ...(status ? { status: status as never } : {}),
        ...(channel ? { channel: channel as never } : {}),
        ...(tableId ? { tableId } : {}),
        ...(cashierId ? { cashierId } : {}),
        ...(businessDate ? { businessDate: new Date(businessDate) } : {}),
      },
      include: { lines: { include: { modifiers: true } }, payments: true, tableSession: { include: { table: true } } },
      orderBy: { createdAt: "desc" },
      take: limit ? Math.min(Number(limit), 200) : 50,
    });
    res.json({ orders });
  }),
);

ordersRouter.get(
  "/open",
  asyncHandler(async (req, res) => {
    const { tableId } = req.query as { tableId?: string };
    const orders = await prisma.order.findMany({
      where: {
        restaurantId: req.auth!.restaurantId,
        status: { in: ["DRAFT", "SENT_TO_KITCHEN", "IN_PROGRESS", "READY"] },
        ...(tableId ? { tableId } : {}),
      },
      include: { lines: { include: { modifiers: true } }, payments: true, tableSession: { include: { table: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ orders });
  }),
);

ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId },
      include: {
        lines: { include: { modifiers: true } },
        payments: { include: { refunds: true } },
        tableSession: { include: { table: true } },
        kitchenTickets: { include: { lines: true } },
      },
    });
    if (!order) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Order not found" } });
      return;
    }
    res.json({ order });
  }),
);

ordersRouter.post(
  "/:id/items",
  requirePermission("pos.use"),
  validate({ body: z.object({ items: z.array(lineSchema).min(1) }) }),
  asyncHandler(async (req, res) => {
    const { items } = req.body as { items: z.infer<typeof lineSchema>[] };
    const order = await addItemsToOrder(String(req.params.id), req.auth!.userId, items);
    res.json({ order });
  }),
);

ordersRouter.post(
  "/:id/send-to-kitchen",
  requirePermission("pos.use"),
  asyncHandler(async (req, res) => {
    const result = await sendToKitchen(String(req.params.id), req.auth!.userId, req.auth!.role);
    res.json(result);
  }),
);

const voidSchema = z.object({ lineId: z.string().uuid(), reason: z.string().min(2), managerPin: z.string().regex(/^\d{4,6}$/).optional() });

ordersRouter.post(
  "/:id/void-line",
  requirePermission("pos.use"),
  validate({ body: voidSchema }),
  asyncHandler(async (req, res) => {
    const { lineId, reason, managerPin } = req.body as z.infer<typeof voidSchema>;
    const order = await voidOrderLine(String(req.params.id), lineId, req.auth!.userId, req.auth!.role, reason, managerPin);
    res.json({ order });
  }),
);

const discountSchema = z.object({
  type: z.enum(["PERCENT", "ABSOLUTE"]),
  value: z.number().positive(),
  reason: z.string().optional(),
  managerPin: z.string().regex(/^\d{4,6}$/).optional(),
});

ordersRouter.post(
  "/:id/discount",
  requirePermission("order.discount.small"),
  validate({ body: discountSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof discountSchema>;
    const order = await applyDiscount(String(req.params.id), req.auth!.userId, req.auth!.role, body);
    res.json({ order });
  }),
);

const cancelSchema = z.object({ reason: z.string().min(2), managerPin: z.string().regex(/^\d{4,6}$/).optional() });

ordersRouter.post(
  "/:id/cancel",
  requirePermission("pos.use"),
  validate({ body: cancelSchema }),
  asyncHandler(async (req, res) => {
    const { reason, managerPin } = req.body as z.infer<typeof cancelSchema>;
    const order = await cancelOrder(String(req.params.id), req.auth!.userId, req.auth!.role, reason, managerPin);
    res.json({ order });
  }),
);

ordersRouter.get(
  "/:id/receipt",
  requirePermission("pos.use"),
  asyncHandler(async (req, res) => {
    const { text } = await receiptTextForOrder(String(req.params.id), false);
    res.json({ receipt: text });
  }),
);

ordersRouter.post(
  "/:id/reprint",
  requirePermission("pos.use"),
  asyncHandler(async (req, res) => {
    const { text, order } = await receiptTextForOrder(String(req.params.id), true);
    const result = await sendToPrinter(env.RECEIPT_PRINTER_IP || null, text);
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      orderId: order.id,
      action: "RECEIPT_REPRINT",
      entityType: "Order",
      entityId: order.id,
      after: { orderNumber: order.orderNumber },
    });
    res.json({ receipt: text, printed: result.ok, mode: result.mode });
  }),
);

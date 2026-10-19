import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { ok } from "../lib/respond.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { can, type Capability } from "../lib/permissions.js";
import { audit } from "../lib/audit.js";
import { env } from "../lib/env.js";
import { sendToPrinter } from "../lib/printers.js";
import { RECEIPT_DEFAULTS, logoValidationError } from "../lib/receiptDefaults.js";
import { renderReceiptHtml, renderReceiptText } from "../lib/receiptRenderer.js";
import {
  auditSafeConfig,
  buildSampleReceiptData,
  configShapeFromRow,
  ensureReceiptConfig,
  printOrderReceipt,
  receiptHtmlForOrder,
  receiptTextForOrder,
  updateReceiptConfig,
  type SampleRestaurant,
} from "../services/receipt.service.js";

export const receiptsRouter = Router();
receiptsRouter.use(requireAuth);

/** Allow the request when the role holds at least one of the capabilities. */
function requireAnyPermission(...capabilities: Capability[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(ApiError.unauthorized());
    if (!capabilities.some((c) => can(req.auth!.role, c))) {
      return next(ApiError.forbidden(`Role ${req.auth!.role} lacks all of: ${capabilities.join(", ")}`));
    }
    next();
  };
}

const configSchema = z.object({
  showShopName: z.boolean().optional(),
  showLogo: z.boolean().optional(),
  logo: z.string().nullable().optional(),
  showAddress: z.boolean().optional(),
  showPhone: z.boolean().optional(),
  headerText: z.string().max(500).nullable().optional(),
  footerText: z.string().max(500).nullable().optional(),
  thankYouText: z.string().max(500).nullable().optional(),
  showOrderNumber: z.boolean().optional(),
  showTable: z.boolean().optional(),
  showDateTime: z.boolean().optional(),
  showCashier: z.boolean().optional(),
  showSubtotal: z.boolean().optional(),
  showServiceCharge: z.boolean().optional(),
  showTax: z.boolean().optional(),
  showDiscount: z.boolean().optional(),
  showTotal: z.boolean().optional(),
  showPaymentMethod: z.boolean().optional(),
  showAmountPaid: z.boolean().optional(),
  showChange: z.boolean().optional(),
  showModifiers: z.boolean().optional(),
  paperWidth: z.union([z.literal(58), z.literal(80)]).optional(),
  fontSize: z.enum(["small", "medium", "large"]).optional(),
  alignment: z.enum(["left", "center"]).optional(),
  showQrCode: z.boolean().optional(),
  qrContent: z.string().max(500).nullable().optional(),
});

async function restaurantForReceipt(restaurantId: string): Promise<SampleRestaurant> {
  const r = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!r) throw ApiError.notFound("Restaurant not found");
  return { name: r.name, currency: r.currency, address: r.address, phone: r.phone, logo: r.logo };
}

function assertOwnOrder(orderRestaurantId: string, authRestaurantId: string): void {
  if (orderRestaurantId !== authRestaurantId) throw ApiError.notFound("Order not found");
}

// ── Config ────────────────────────────────────────────────

receiptsRouter.get(
  "/config",
  asyncHandler(async (req, res) => {
    const row = await ensureReceiptConfig(req.auth!.restaurantId);
    ok(res, { config: configShapeFromRow(row) });
  }),
);

receiptsRouter.get(
  "/defaults",
  requirePermission("settings.manage"),
  asyncHandler((_req, res) => {
    ok(res, { defaults: RECEIPT_DEFAULTS });
    return Promise.resolve();
  }),
);

receiptsRouter.put(
  "/config",
  requirePermission("settings.manage"),
  validate({ body: configSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof configSchema>;
    if (body.logo !== undefined) {
      const err = logoValidationError(body.logo);
      if (err) throw ApiError.badRequest(err);
    }
    const before = configShapeFromRow(await ensureReceiptConfig(req.auth!.restaurantId));
    const row = await updateReceiptConfig(req.auth!.restaurantId, body);
    const after = configShapeFromRow(row);
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "RECEIPT_CONFIG_UPDATED",
      entityType: "ReceiptConfig",
      entityId: row.id,
      before: auditSafeConfig(before),
      after: auditSafeConfig(after),
    });
    ok(res, { config: after });
  }),
);

// ── Preview & test print ──────────────────────────────────

receiptsRouter.post(
  "/preview",
  requirePermission("settings.manage"),
  validate({ body: configSchema }),
  asyncHandler(async (req, res) => {
    const overrides = req.body as z.infer<typeof configSchema>;
    const current = configShapeFromRow(await ensureReceiptConfig(req.auth!.restaurantId));
    const restaurant = await restaurantForReceipt(req.auth!.restaurantId);
    const data = await buildSampleReceiptData({ ...current, ...overrides }, restaurant);
    ok(res, { html: renderReceiptHtml(data) });
  }),
);

receiptsRouter.post(
  "/test-print",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const current = configShapeFromRow(await ensureReceiptConfig(req.auth!.restaurantId));
    const restaurant = await restaurantForReceipt(req.auth!.restaurantId);
    const data = await buildSampleReceiptData(current, restaurant);
    const result = await sendToPrinter(env.RECEIPT_PRINTER_IP || null, renderReceiptText(data));
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "RECEIPT_TEST_PRINT",
      entityType: "Restaurant",
      entityId: req.auth!.restaurantId,
      after: { ok: result.ok, mode: result.mode, error: result.error ?? null },
    });
    ok(res, result);
  }),
);

// ── Per-order receipts ────────────────────────────────────

receiptsRouter.get(
  "/order/:orderId/html",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const { html, order } = await receiptHtmlForOrder(String(req.params.orderId), false);
    assertOwnOrder(order.restaurantId, req.auth!.restaurantId);
    ok(res, { html });
  }),
);

receiptsRouter.get(
  "/order/:orderId/text",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const { text, order } = await receiptTextForOrder(String(req.params.orderId), false);
    assertOwnOrder(order.restaurantId, req.auth!.restaurantId);
    ok(res, { text });
  }),
);

receiptsRouter.post(
  "/order/:orderId/print",
  requireAnyPermission("pos.use", "report.view"),
  asyncHandler(async (req, res) => {
    const { result, order, text } = await printOrderReceipt(String(req.params.orderId));
    assertOwnOrder(order.restaurantId, req.auth!.restaurantId);
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      orderId: order.id,
      action: "RECEIPT_REPRINTED",
      entityType: "Order",
      entityId: order.id,
      after: { orderNumber: order.orderNumber, ok: result.ok, mode: result.mode },
    });
    ok(res, { ok: result.ok, mode: result.mode, simulated: result.simulated, receipt: text });
  }),
);

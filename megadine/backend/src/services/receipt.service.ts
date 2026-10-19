/**
 * Receipt-customization service: config persistence, order/sample data
 * assembly, QR generation and best-effort thermal printing.
 */
import QRCode from "qrcode";
import os from "node:os";
import type { Prisma, ReceiptConfig } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { toCents } from "../lib/money.js";
import { env } from "../lib/env.js";
import { audit } from "../lib/audit.js";
import { sendToPrinter, type PrintResult } from "../lib/printers.js";
import { RECEIPT_DEFAULTS, type ReceiptConfigShape } from "../lib/receiptDefaults.js";
import { renderReceiptHtml, renderReceiptText, type ReceiptData } from "../lib/receiptRenderer.js";

// ── QR codes ──────────────────────────────────────────────

const qrCache = new Map<string, string>();

/** PNG data URL for a QR payload, cached by content (PRD spec §7.5). */
export async function qrDataUrlFor(value: string): Promise<string> {
  const cached = qrCache.get(value);
  if (cached) return cached;
  const url = await QRCode.toDataURL(value, { width: 120, margin: 1 });
  qrCache.set(value, url);
  return url;
}

/** Best-effort LAN URL of the frontend host, used as the default QR target. */
export function lanUrl(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) return `http://${net.address}:5173`;
    }
  }
  return "http://localhost:5173";
}

// ── Config persistence ────────────────────────────────────

export function configShapeFromRow(row: ReceiptConfig): ReceiptConfigShape {
  return {
    showShopName: row.showShopName,
    showLogo: row.showLogo,
    logo: row.logo,
    showAddress: row.showAddress,
    showPhone: row.showPhone,
    headerText: row.headerText,
    footerText: row.footerText,
    thankYouText: row.thankYouText,
    showOrderNumber: row.showOrderNumber,
    showTable: row.showTable,
    showDateTime: row.showDateTime,
    showCashier: row.showCashier,
    showSubtotal: row.showSubtotal,
    showServiceCharge: row.showServiceCharge,
    showTax: row.showTax,
    showDiscount: row.showDiscount,
    showTotal: row.showTotal,
    showPaymentMethod: row.showPaymentMethod,
    showAmountPaid: row.showAmountPaid,
    showChange: row.showChange,
    showModifiers: row.showModifiers,
    paperWidth: row.paperWidth,
    fontSize: (["small", "medium", "large"] as const).includes(row.fontSize as never)
      ? (row.fontSize as ReceiptConfigShape["fontSize"])
      : "medium",
    alignment: row.alignment === "center" ? "center" : "left",
    showQrCode: row.showQrCode,
    qrContent: row.qrContent,
  };
}

/**
 * Auto-provision the per-restaurant config on first access, seeding the
 * legacy header/footer columns so existing installs keep their messages.
 */
export async function ensureReceiptConfig(restaurantId: string): Promise<ReceiptConfig> {
  const existing = await prisma.receiptConfig.findUnique({ where: { restaurantId } });
  if (existing) return existing;
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  try {
    return await prisma.receiptConfig.create({
      data: {
        restaurantId,
        headerText: restaurant.receiptHeader ?? RECEIPT_DEFAULTS.headerText,
        footerText: restaurant.receiptFooter ?? RECEIPT_DEFAULTS.footerText,
      },
    });
  } catch (err) {
    // Concurrent first access: fall back to the row the other request created.
    if ((err as { code?: string }).code === "P2002") {
      const row = await prisma.receiptConfig.findUnique({ where: { restaurantId } });
      if (row) return row;
    }
    throw err;
  }
}

export async function updateReceiptConfig(
  restaurantId: string,
  patch: Partial<ReceiptConfigShape>,
): Promise<ReceiptConfig> {
  const current = await ensureReceiptConfig(restaurantId);
  const merged = { ...configShapeFromRow(current), ...patch };
  return prisma.receiptConfig.update({
    where: { restaurantId },
    data: {
      showShopName: merged.showShopName,
      showLogo: merged.showLogo,
      logo: merged.logo,
      showAddress: merged.showAddress,
      showPhone: merged.showPhone,
      headerText: merged.headerText,
      footerText: merged.footerText,
      thankYouText: merged.thankYouText,
      showOrderNumber: merged.showOrderNumber,
      showTable: merged.showTable,
      showDateTime: merged.showDateTime,
      showCashier: merged.showCashier,
      showSubtotal: merged.showSubtotal,
      showServiceCharge: merged.showServiceCharge,
      showTax: merged.showTax,
      showDiscount: merged.showDiscount,
      showTotal: merged.showTotal,
      showPaymentMethod: merged.showPaymentMethod,
      showAmountPaid: merged.showAmountPaid,
      showChange: merged.showChange,
      showModifiers: merged.showModifiers,
      paperWidth: merged.paperWidth,
      fontSize: merged.fontSize,
      alignment: merged.alignment,
      showQrCode: merged.showQrCode,
      qrContent: merged.qrContent,
    },
  });
}

/** Redact the logo bytes before writing configs into the audit trail. */
export function auditSafeConfig(config: ReceiptConfigShape): ReceiptConfigShape {
  if (!config.logo) return config;
  const bytes = Math.floor((config.logo.split(",")[1]?.replace(/\s/g, "").length ?? 0) * 0.75);
  return { ...config, logo: `<logo data URL, ${bytes} bytes>` };
}

// ── Order data assembly ───────────────────────────────────

const orderInclude = {
  payments: true,
  lines: { include: { modifiers: true } },
  tableSession: { include: { table: true } },
  cashier: { select: { name: true } },
} satisfies Prisma.OrderInclude;

export type ReceiptOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

async function dataForOrder(order: ReceiptOrder, config: ReceiptConfigShape, reprint: boolean): Promise<ReceiptData> {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: order.restaurantId } });
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const methods = [...new Set(order.payments.filter((p) => p.status === "SUCCEEDED").map((p) => p.method))];
  const qrValue = config.showQrCode ? config.qrContent?.trim() || lanUrl() : null;
  let qrDataUrl: string | null = null;
  if (qrValue) {
    try {
      qrDataUrl = await qrDataUrlFor(qrValue);
    } catch (err) {
      console.error("[receipt] QR generation failed", err);
    }
  }

  return {
    currency: restaurant.currency,
    shopName: restaurant.name,
    logo: config.logo ?? restaurant.logo,
    address: restaurant.address,
    phone: restaurant.phone,
    orderNumber: order.orderNumber,
    tableName: order.tableSession?.table ? `#${order.tableSession.table.number}` : null,
    createdAt: order.createdAt,
    cashierName: order.cashier?.name ?? null,
    channel: order.channel,
    lines: order.lines
      .filter((l) => !l.isVoided)
      .map((l) => ({
        name: l.itemNameSnapshot,
        quantity: l.quantity,
        unitPrice: toCents(l.unitPriceSnapshot),
        lineTotal: toCents(l.lineTotal),
        modifiers: l.modifiers.map((m) => ({ name: m.nameSnapshot, price: toCents(m.priceSnapshot) })),
        notes: l.notes,
      })),
    subtotal: toCents(order.subtotal),
    serviceCharge: toCents(order.serviceCharge),
    taxAmount: toCents(order.taxAmount),
    discountAmount: toCents(order.discountAmount),
    total: toCents(order.total),
    amountPaid: toCents(order.amountPaid),
    changeGiven: toCents(order.changeGiven),
    paymentMethod: methods.length ? methods.join(" + ") : null,
    qrValue,
    qrDataUrl,
    reprint,
    config,
  };
}

export async function receiptDataForOrder(
  orderId: string,
  opts: { reprint?: boolean } = {},
): Promise<{ data: ReceiptData; order: ReceiptOrder }> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw ApiError.notFound("Order not found");
  const configRow = await ensureReceiptConfig(order.restaurantId);
  const data = await dataForOrder(order, configShapeFromRow(configRow), opts.reprint ?? false);
  return { data, order };
}

export async function receiptTextForOrder(orderId: string, reprint = false) {
  const { data, order } = await receiptDataForOrder(orderId, { reprint });
  return { text: renderReceiptText(data), order };
}

export async function receiptHtmlForOrder(orderId: string, reprint = false) {
  const { data, order } = await receiptDataForOrder(orderId, { reprint });
  return { html: renderReceiptHtml(data), order };
}

// ── Test-print sample ─────────────────────────────────────

export interface SampleRestaurant {
  name: string;
  currency: string;
  address: string | null;
  phone: string | null;
  logo: string | null;
}

/** Fixed example items so operators can evaluate layout before saving. */
export async function buildSampleReceiptData(
  config: ReceiptConfigShape,
  restaurant: SampleRestaurant,
): Promise<ReceiptData> {
  const qrValue = config.showQrCode ? config.qrContent?.trim() || lanUrl() : null;
  let qrDataUrl: string | null = null;
  if (qrValue) {
    try {
      qrDataUrl = await qrDataUrlFor(qrValue);
    } catch (err) {
      console.error("[receipt] QR generation failed", err);
    }
  }

  const lines = [
    {
      name: "Chicken Burger",
      quantity: 2,
      unitPrice: 850,
      lineTotal: 1700,
      modifiers: [
        { name: "Extra Cheese", price: 100 },
        { name: "Bacon", price: 150 },
      ],
      notes: null,
    },
    { name: "Caesar Salad", quantity: 1, unitPrice: 700, lineTotal: 700, modifiers: [], notes: null },
    { name: "Iced Lemon Tea", quantity: 2, unitPrice: 350, lineTotal: 700, modifiers: [], notes: "Less ice" },
  ];
  const subtotal = 3100;
  const serviceCharge = 155;
  const taxAmount = 264;
  const discountAmount = 200;
  const total = subtotal + serviceCharge + taxAmount - discountAmount;

  return {
    currency: restaurant.currency,
    shopName: restaurant.name,
    logo: config.logo ?? restaurant.logo,
    address: restaurant.address,
    phone: restaurant.phone,
    orderNumber: 1001,
    tableName: "#7",
    createdAt: new Date(),
    cashierName: "Demo Cashier",
    channel: "DINE_IN",
    lines,
    subtotal,
    serviceCharge,
    taxAmount,
    discountAmount,
    total,
    amountPaid: 3500,
    changeGiven: 3500 - total,
    paymentMethod: "CASH",
    qrValue,
    qrDataUrl,
    reprint: false,
    config,
  };
}

// ── Printing helpers ──────────────────────────────────────

export async function printOrderReceipt(orderId: string): Promise<{ result: PrintResult; order: ReceiptOrder; text: string }> {
  const { text, order } = await receiptTextForOrder(orderId, true);
  const result = await sendToPrinter(env.RECEIPT_PRINTER_IP || null, text);
  return { result, order, text };
}

/** Per-person receipt for a bill split (Phase 3): only that person's items and amounts. */
export async function receiptTextForSplit(orderId: string, splitId: string) {
  const split = await prisma.orderSplit.findUnique({ where: { id: splitId } });
  if (!split || split.orderId !== orderId) throw ApiError.notFound("Split not found");
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw ApiError.notFound("Order not found");

  const configRow = await ensureReceiptConfig(order.restaurantId);
  const base = await dataForOrder(order, configShapeFromRow(configRow), true);
  const splitLines = order.lines.filter((l) => !l.isVoided && split.lineIds.includes(l.id));

  const data: ReceiptData = {
    ...base,
    lines: splitLines.map((l) => ({
      name: l.itemNameSnapshot,
      quantity: l.quantity,
      unitPrice: toCents(l.unitPriceSnapshot),
      lineTotal: toCents(l.lineTotal),
      modifiers: l.modifiers.map((m) => ({ name: m.nameSnapshot, price: toCents(m.priceSnapshot) })),
      notes: l.notes,
    })),
    subtotal: toCents(split.subtotal),
    serviceCharge: toCents(split.serviceCharge),
    taxAmount: toCents(split.tax),
    discountAmount: toCents(split.discount),
    total: toCents(split.total),
    amountPaid: split.paid ? toCents(split.total) : 0,
    changeGiven: 0,
    paymentMethod: split.paid ? "Split" : null,
    splitLabel: split.personName,
  };
  return { text: renderReceiptText(data), order, split };
}

export async function printSplitReceipt(orderId: string, splitId: string) {
  const { text, order } = await receiptTextForSplit(orderId, splitId);
  const result = await sendToPrinter(env.RECEIPT_PRINTER_IP || null, text);
  return { result, order, text };
}

/**
 * Fire-and-forget receipt print after a completed payment (spec §6.5).
 * Failures are logged and audited but never surface to the cashier.
 */
export function autoPrintReceipt(orderId: string, ctx: { restaurantId: string; actorId: string }): void {
  if (!env.AUTO_PRINT_RECEIPT) return;
  void (async () => {
    try {
      const { text } = await receiptTextForOrder(orderId, false);
      const result = await sendToPrinter(env.RECEIPT_PRINTER_IP || null, text);
      if (!result.ok) {
        await audit({
          restaurantId: ctx.restaurantId,
          userId: ctx.actorId,
          orderId,
          action: "RECEIPT_AUTO_PRINT_FAILED",
          entityType: "Order",
          entityId: orderId,
          after: { error: result.error ?? "unknown", mode: result.mode },
        });
      }
    } catch (err) {
      console.error("[receipt] auto-print failed", err);
      await audit({
        restaurantId: ctx.restaurantId,
        userId: ctx.actorId,
        orderId,
        action: "RECEIPT_AUTO_PRINT_FAILED",
        entityType: "Order",
        entityId: orderId,
        after: { error: (err as Error).message },
      });
    }
  })();
}

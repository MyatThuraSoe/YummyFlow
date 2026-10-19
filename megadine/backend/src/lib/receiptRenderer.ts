/**
 * Unified receipt renderer — pure module, no side effects.
 *
 * A single config-driven block list feeds both serializers, so the HTML
 * preview (and PDF/browser printing) always matches the plain-text ESC/POS
 * output sent to the thermal printer.
 */
import { fromCents } from "./money.js";
import type { ReceiptConfigShape } from "./receiptDefaults.js";

export interface ReceiptData {
  currency: string;
  // Identity (from Restaurant + ReceiptConfig)
  shopName: string;
  logo?: string | null;
  address?: string | null;
  phone?: string | null;
  // Order data
  orderNumber: number;
  tableName?: string | null;
  createdAt: Date;
  cashierName?: string | null;
  channel: string; // DINE_IN | TAKEAWAY | PARCEL
  lines: {
    name: string;
    quantity: number;
    unitPrice: number; // cents
    lineTotal: number; // cents
    modifiers?: { name: string; price: number }[]; // prices in cents
    notes?: string | null;
  }[];
  // Money (cents)
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  amountPaid: number;
  changeGiven: number;
  paymentMethod?: string | null;
  // Extras
  qrValue?: string | null;
  qrDataUrl?: string | null;
  reprint?: boolean;
  config: ReceiptConfigShape;
}

export type Block =
  | { kind: "image"; src: string; alt?: string; cssClass?: string }
  | { kind: "text"; text: string; align: "left" | "center" | "right"; bold?: boolean }
  | { kind: "row"; left: string; right: string; bold?: boolean }
  | { kind: "divider" }
  | { kind: "qr"; value: string; src?: string | null };

const CHANNEL_LABELS: Record<string, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  PARCEL: "Parcel",
};

/** Printable character width for the text renderer (58 mm ≈ 32, 80 mm ≈ 48). */
export function lineWidth(config: Pick<ReceiptConfigShape, "paperWidth" | "fontSize">): number {
  const base = config.paperWidth === 58 ? 32 : 48;
  const delta = config.fontSize === "small" ? 6 : config.fontSize === "large" ? -6 : 0;
  return Math.max(24, base + delta);
}

const money = (cents: number) => fromCents(Math.round(cents));

function multiline(text: string | null | undefined, align: "left" | "center" | "right"): Block[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => ({ kind: "text" as const, text: l, align }));
}

/** Config-driven ordered block list shared by both output formats. */
export function buildBlocks(data: ReceiptData): Block[] {
  const c = data.config;
  const blocks: Block[] = [];

  // 1-4. Identity block
  if (c.showLogo && data.logo && data.logo.startsWith("data:image/")) {
    blocks.push({ kind: "image", src: data.logo, alt: "logo", cssClass: "r-logo" });
  }
  if (c.showShopName) blocks.push({ kind: "text", text: data.shopName, align: c.alignment, bold: true });
  if (c.showAddress && data.address) blocks.push(...multiline(data.address, c.alignment));
  if (c.showPhone && data.phone) blocks.push({ kind: "text", text: data.phone, align: c.alignment });
  blocks.push(...multiline(c.headerText, c.alignment));

  // 5-7. Divider + meta
  blocks.push({ kind: "divider" });
  if (data.reprint) blocks.push({ kind: "text", text: "*** REPRINT ***", align: "center", bold: true });
  if (c.showOrderNumber) blocks.push({ kind: "row", left: "Order #", right: String(data.orderNumber) });
  if (c.showTable && data.tableName) blocks.push({ kind: "row", left: "Table", right: data.tableName });
  if (c.showDateTime) blocks.push({ kind: "row", left: "Date", right: data.createdAt.toLocaleString() });
  if (c.showCashier && data.cashierName) blocks.push({ kind: "row", left: "Cashier", right: data.cashierName });
  blocks.push({ kind: "row", left: "Channel", right: CHANNEL_LABELS[data.channel] ?? data.channel });

  // 8. Items
  blocks.push({ kind: "divider" });
  for (const l of data.lines) {
    blocks.push({ kind: "row", left: `${l.quantity}x ${l.name}`, right: money(l.lineTotal) });
    if (c.showModifiers) {
      for (const m of l.modifiers ?? []) {
        blocks.push({ kind: "text", text: `  + ${m.name}${m.price ? ` (+${money(m.price)})` : ""}`, align: "left" });
      }
      if (l.notes) blocks.push({ kind: "text", text: `  * ${l.notes}`, align: "left" });
    }
  }

  // 9-11. Totals + payment
  blocks.push({ kind: "divider" });
  if (c.showSubtotal) blocks.push({ kind: "row", left: "Subtotal", right: money(data.subtotal) });
  if (c.showServiceCharge && data.serviceCharge > 0) blocks.push({ kind: "row", left: "Service", right: money(data.serviceCharge) });
  if (c.showTax && data.taxAmount > 0) blocks.push({ kind: "row", left: "Tax", right: money(data.taxAmount) });
  if (c.showDiscount && data.discountAmount > 0) blocks.push({ kind: "row", left: "Discount", right: `-${money(data.discountAmount)}` });
  if (c.showTotal) blocks.push({ kind: "row", left: "TOTAL", right: money(data.total), bold: true });
  if (c.showPaymentMethod && data.paymentMethod) blocks.push({ kind: "row", left: "Payment", right: data.paymentMethod });
  if (c.showAmountPaid && data.amountPaid > 0) blocks.push({ kind: "row", left: "Paid", right: money(data.amountPaid) });
  if (c.showChange && data.changeGiven > 0) blocks.push({ kind: "row", left: "Change", right: money(data.changeGiven) });

  // 12-14. Footer messages + QR
  blocks.push(...multiline(c.footerText, c.alignment));
  blocks.push(...multiline(c.thankYouText, "center"));
  if (c.showQrCode) blocks.push({ kind: "qr", value: data.qrValue ?? "", src: data.qrDataUrl ?? null });

  return blocks;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** HTML output for the live preview / browser printing. */
export function renderReceiptHtml(data: ReceiptData): string {
  return buildBlocks(data)
    .map((b) => {
      switch (b.kind) {
        case "image":
          return `<img class="${b.cssClass ?? "r-img"}" src="${esc(b.src)}" alt="${esc(b.alt ?? "")}" />`;
        case "text":
          return `<div class="r-${b.align}${b.bold ? " r-bold" : ""}">${esc(b.text)}</div>`;
        case "row":
          return `<div class="r-row${b.bold ? " r-bold" : ""}"><span>${esc(b.left)}</span><span>${esc(b.right)}</span></div>`;
        case "divider":
          return `<div class="r-divider"></div>`;
        case "qr":
          return b.src
            ? `<img class="r-qr" src="${esc(b.src)}" alt="QR code" />`
            : `<div class="r-center r-bold">[QR] ${esc(b.value)}</div>`;
      }
    })
    .join("\n");
}

/** Plain-text output for the thermal printer (images are HTML-only). */
export function renderReceiptText(data: ReceiptData): string {
  const width = lineWidth(data.config);
  const pad = (s: string, align: "left" | "center" | "right") => {
    const t = s.slice(0, width);
    if (align === "center") {
      const p = Math.max(0, Math.floor((width - t.length) / 2));
      return " ".repeat(p) + t;
    }
    if (align === "right") return " ".repeat(Math.max(0, width - t.length)) + t;
    return t;
  };
  const row = (left: string, right: string) => {
    const r = right.slice(0, width);
    const l = left.slice(0, Math.max(0, width - r.length - 1));
    return l + " ".repeat(Math.max(1, width - l.length - r.length)) + r;
  };

  const out: string[] = [];
  for (const b of buildBlocks(data)) {
    if (b.kind === "image") continue; // thermal logo rastering is a future item
    if (b.kind === "text") out.push(b.text.startsWith("  ") ? b.text.slice(0, width) : pad(b.text, b.align));
    else if (b.kind === "row") out.push(row(b.left, b.right));
    else if (b.kind === "divider") out.push("-".repeat(width));
    else if (b.kind === "qr") out.push(pad("[QR]", "center")); // ESC/POS QR raster is a future item
  }
  out.push("");
  out.push("");
  return out.join("\n");
}

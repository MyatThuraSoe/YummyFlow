import "../scripts/_hermetic-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOGO_MAX_BYTES, RECEIPT_DEFAULTS, logoValidationError, type ReceiptConfigShape } from "../src/lib/receiptDefaults.js";
import {
  buildBlocks,
  lineWidth,
  renderReceiptHtml,
  renderReceiptText,
  type Block,
  type ReceiptData,
} from "../src/lib/receiptRenderer.js";

function baseData(overrides: Partial<ReceiptConfigShape> = {}): ReceiptData {
  return {
    currency: "USD",
    shopName: "MegaDine Bistro",
    logo: "data:image/png;base64,iVBORw0KGgo=",
    address: "12 Main St",
    phone: "+1 555 0100",
    orderNumber: 1042,
    tableName: "#7",
    createdAt: new Date("2026-10-18T12:30:00Z"),
    cashierName: "Cara Cashier",
    channel: "DINE_IN",
    lines: [
      {
        name: "Chicken Burger",
        quantity: 2,
        unitPrice: 850,
        lineTotal: 1700,
        modifiers: [{ name: "Extra Cheese", price: 100 }],
        notes: "No onion",
      },
      { name: "Caesar Salad", quantity: 1, unitPrice: 700, lineTotal: 700, modifiers: [], notes: null },
    ],
    subtotal: 2400,
    serviceCharge: 120,
    taxAmount: 197,
    discountAmount: 200,
    total: 2517,
    amountPaid: 2600,
    changeGiven: 83,
    paymentMethod: "CASH",
    qrValue: "http://192.168.1.10:5173",
    qrDataUrl: "data:image/png;base64,qr==",
    reprint: false,
    config: { ...RECEIPT_DEFAULTS, ...overrides },
  };
}

// ── §15.1.1 field visibility ─────────────────────────────
const toggleCases: { flag: keyof ReceiptConfigShape; present: (b: Block) => boolean }[] = [
  { flag: "showShopName", present: (b) => b.kind === "text" && b.text === "MegaDine Bistro" },
  { flag: "showLogo", present: (b) => b.kind === "image" },
  { flag: "showAddress", present: (b) => b.kind === "text" && b.text === "12 Main St" },
  { flag: "showPhone", present: (b) => b.kind === "text" && b.text === "+1 555 0100" },
  { flag: "showOrderNumber", present: (b) => b.kind === "row" && b.left === "Order #" },
  { flag: "showTable", present: (b) => b.kind === "row" && b.left === "Table" },
  { flag: "showDateTime", present: (b) => b.kind === "row" && b.left === "Date" },
  { flag: "showCashier", present: (b) => b.kind === "row" && b.left === "Cashier" },
  { flag: "showSubtotal", present: (b) => b.kind === "row" && b.left === "Subtotal" },
  { flag: "showServiceCharge", present: (b) => b.kind === "row" && b.left === "Service" },
  { flag: "showTax", present: (b) => b.kind === "row" && b.left === "Tax" },
  { flag: "showDiscount", present: (b) => b.kind === "row" && b.left === "Discount" },
  { flag: "showTotal", present: (b) => b.kind === "row" && b.left === "TOTAL" },
  { flag: "showPaymentMethod", present: (b) => b.kind === "row" && b.left === "Payment" },
  { flag: "showAmountPaid", present: (b) => b.kind === "row" && b.left === "Paid" },
  { flag: "showChange", present: (b) => b.kind === "row" && b.left === "Change" },
  { flag: "showModifiers", present: (b) => b.kind === "text" && b.text.includes("Extra Cheese") },
  { flag: "showQrCode", present: (b) => b.kind === "qr" },
];

test("every field toggle hides its content when off and shows it when on", () => {
  for (const { flag, present } of toggleCases) {
    const enabled = buildBlocks(baseData({ [flag]: true }));
    const disabled = buildBlocks(baseData({ [flag]: false }));
    assert.ok(enabled.some(present), `${flag}=true should render its content`);
    assert.ok(!disabled.some(present), `${flag}=false should hide its content`);
  }
});

test("modifier lines appear under their item only when enabled", () => {
  const withMods = renderReceiptText(baseData({ showModifiers: true }));
  assert.ok(withMods.includes("+ Extra Cheese"));
  const without = renderReceiptText(baseData({ showModifiers: false }));
  assert.ok(!without.includes("Extra Cheese"));
});

// ── §15.1.2 layout ───────────────────────────────────────
test("lineWidth follows paper width and font size", () => {
  assert.equal(lineWidth({ paperWidth: 58, fontSize: "medium" }), 32);
  assert.equal(lineWidth({ paperWidth: 80, fontSize: "medium" }), 48);
  assert.equal(lineWidth({ paperWidth: 58, fontSize: "small" }), 38);
  assert.equal(lineWidth({ paperWidth: 80, fontSize: "large" }), 42);
});

test("text renderer never exceeds the configured width and right-aligns values", () => {
  const text = renderReceiptText(baseData({ paperWidth: 58 }));
  for (const line of text.split("\n")) assert.ok(line.length <= 32, `line too long: "${line}"`);
  const subtotal = text.split("\n").find((l) => l.startsWith("Subtotal"));
  assert.ok(subtotal && subtotal.length === 32 && subtotal.endsWith("24.00"));
  const dividers = text.split("\n").filter((l) => l === "-".repeat(32));
  assert.ok(dividers.length >= 3);
});

test("center alignment centers simple text lines", () => {
  const text = renderReceiptText(baseData({ alignment: "center" }));
  const nameLine = text.split("\n").find((l) => l.trim() === "MegaDine Bistro");
  assert.ok(nameLine && nameLine.startsWith(" "), "shop name should be indented when centered");
});

// ── §15.1.3 money formatting ─────────────────────────────
test("money renders with two decimals, no currency symbols, discount negative", () => {
  const text = renderReceiptText(baseData());
  const discount = text.split("\n").find((l) => l.startsWith("Discount"));
  assert.ok(discount?.endsWith("-2.00"), "discount should be prefixed with minus");
  const total = text.split("\n").find((l) => l.startsWith("TOTAL"));
  assert.ok(total?.endsWith("25.17"));
  const html = renderReceiptHtml(baseData());
  assert.ok(html.includes("-2.00"));
  assert.ok(!/[$€£]/.test(text), "no currency symbols in plain text output");
});

// ── Messages, reprint, QR, logo validation ───────────────
test("custom messages render in order with the thank-you centered", () => {
  const blocks = buildBlocks(baseData({ headerText: "Welcome\nLine two", footerText: "Wi-Fi: guest" }));
  const texts = blocks.filter((b) => b.kind === "text");
  assert.ok(texts.some((b) => b.kind === "text" && b.text === "Welcome"));
  assert.ok(texts.some((b) => b.kind === "text" && b.text === "Line two"));
  assert.ok(texts.some((b) => b.kind === "text" && b.text === "Wi-Fi: guest"));
  const thank = texts.find((b) => b.kind === "text" && b.text.includes("come again"));
  assert.ok(thank && thank.kind === "text" && thank.align === "center");
});

test("reprint marker renders in both output formats", () => {
  const data = { ...baseData(), reprint: true };
  assert.ok(renderReceiptText(data).includes("*** REPRINT ***"));
  assert.ok(renderReceiptHtml(data).includes("*** REPRINT ***"));
});

test("qr block renders as an image in HTML and [QR] in plain text", () => {
  const html = renderReceiptHtml(baseData({ showQrCode: true }));
  assert.ok(html.includes('class="r-qr"'));
  const text = renderReceiptText(baseData({ showQrCode: true }));
  assert.ok(text.includes("[QR]"));
});

test("logo validation enforces data-URL type and 200 KB cap", () => {
  assert.equal(logoValidationError(null), null);
  assert.equal(logoValidationError(""), null);
  assert.equal(logoValidationError("data:image/png;base64,iVBORw0KGgo="), null);
  assert.ok(logoValidationError("data:image/gif;base64,R0lGODlh"));
  assert.ok(logoValidationError("data:image/png;base64,!!!"));
  assert.ok(logoValidationError(123));
  const oversize = "data:image/png;base64," + "A".repeat(Math.ceil((LOGO_MAX_BYTES / 3) * 4) + 8);
  assert.ok(logoValidationError(oversize), "oversized logo should be rejected");
});

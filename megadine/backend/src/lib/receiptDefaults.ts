/**
 * Receipt-customization defaults and logo validation.
 *
 * This is the single source of truth for the default configuration; it is used
 * for auto-provisioning (GET /receipts/config), the reset-to-default endpoint
 * and the frontend Reset button.
 */

export interface ReceiptConfigShape {
  // Identity block
  showShopName: boolean;
  showLogo: boolean;
  logo: string | null;
  showAddress: boolean;
  showPhone: boolean;

  // Custom messages
  headerText: string | null;
  footerText: string | null;
  thankYouText: string | null;

  // Field visibility
  showOrderNumber: boolean;
  showTable: boolean;
  showDateTime: boolean;
  showCashier: boolean;
  showSubtotal: boolean;
  showServiceCharge: boolean;
  showTax: boolean;
  showDiscount: boolean;
  showTotal: boolean;
  showPaymentMethod: boolean;
  showAmountPaid: boolean;
  showChange: boolean;
  showModifiers: boolean;

  // Layout
  paperWidth: number; // 58 | 80 (mm)
  fontSize: "small" | "medium" | "large";
  alignment: "left" | "center";

  // Extras
  showQrCode: boolean;
  qrContent: string | null;
}

export const RECEIPT_DEFAULTS: ReceiptConfigShape = {
  showShopName: true,
  showLogo: false,
  logo: null,
  showAddress: false,
  showPhone: false,
  headerText: "",
  footerText: "",
  thankYouText: "Thank you, come again!",
  showOrderNumber: true,
  showTable: true,
  showDateTime: true,
  showCashier: true,
  showSubtotal: true,
  showServiceCharge: true,
  showTax: true,
  showDiscount: true,
  showTotal: true,
  showPaymentMethod: true,
  showAmountPaid: true,
  showChange: true,
  showModifiers: true,
  paperWidth: 80,
  fontSize: "medium",
  alignment: "left",
  showQrCode: false,
  qrContent: null,
};

export const LOGO_MAX_BYTES = 200 * 1024;
const LOGO_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,/;

/** Returns an error message when the logo data URL is invalid, else null. */
export function logoValidationError(logo: unknown): string | null {
  if (logo === null || logo === undefined || logo === "") return null;
  if (typeof logo !== "string") return "Logo must be a data URL string";
  if (!LOGO_DATA_URL_RE.test(logo)) return "Logo must be a PNG, JPEG or WebP data URL";
  const b64 = logo.slice(logo.indexOf(",") + 1).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return "Logo data is not valid base64";
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > LOGO_MAX_BYTES) return `Logo must be ${LOGO_MAX_BYTES / 1024} KB or smaller`;
  return null;
}

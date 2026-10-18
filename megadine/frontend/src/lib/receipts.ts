import { apiGet, apiPost, apiPut } from "./api";

export interface ReceiptConfig {
  showShopName: boolean;
  showLogo: boolean;
  logo: string | null;
  showAddress: boolean;
  showPhone: boolean;
  headerText: string | null;
  footerText: string | null;
  thankYouText: string | null;
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
  paperWidth: number;
  fontSize: "small" | "medium" | "large";
  alignment: "left" | "center";
  showQrCode: boolean;
  qrContent: string | null;
}

export interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export const RECEIPT_LOGO_MAX_BYTES = 200 * 1024;

export const fetchReceiptConfig = () =>
  apiGet<Envelope<{ config: ReceiptConfig }>>("/receipts/config").then((r) => r.data.config);

export const fetchReceiptDefaults = () =>
  apiGet<Envelope<{ defaults: ReceiptConfig }>>("/receipts/defaults").then((r) => r.data.defaults);

export const saveReceiptConfig = (config: Partial<ReceiptConfig>) =>
  apiPut<Envelope<{ config: ReceiptConfig }>>("/receipts/config", config).then((r) => r.data.config);

export const previewReceiptHtml = (config: Partial<ReceiptConfig>) =>
  apiPost<Envelope<{ html: string }>>("/receipts/preview", config).then((r) => r.data.html);

export const testPrintReceipt = () =>
  apiPost<Envelope<{ ok: boolean; mode: string; simulated: boolean; preview: string }>>("/receipts/test-print").then((r) => r.data);

export const fetchOrderReceiptHtml = (orderId: string) =>
  apiGet<Envelope<{ html: string }>>(`/receipts/order/${orderId}/html`).then((r) => r.data.html);

export const fetchOrderReceiptText = (orderId: string) =>
  apiGet<Envelope<{ text: string }>>(`/receipts/order/${orderId}/text`).then((r) => r.data.text);

export const printOrderReceipt = (orderId: string) =>
  apiPost<Envelope<{ ok: boolean; mode: string; simulated: boolean; receipt: string }>>(
    `/receipts/order/${orderId}/print`,
  ).then((r) => r.data);

/** Client-side validation mirroring the backend logo rules. */
export function logoError(dataUrl: string, mime: string, bytes: number): string | null {
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) return "type";
  if (bytes > RECEIPT_LOGO_MAX_BYTES) return "size";
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) return "type";
  return null;
}

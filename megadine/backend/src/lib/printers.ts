import net from "node:net";
import { fromCents } from "./money.js";
import { env } from "./env.js";

const WIDTH = 32; // chars for a 58mm thermal printer

export interface PrintResult {
  ok: boolean;
  mode: "simulate" | "tcp";
  simulated: boolean;
  error?: string;
  preview: string;
}

/** Send raw ESC/POS-ish text to a network printer. Falls back cleanly. */
export async function sendToPrinter(ip: string | null, text: string): Promise<PrintResult> {
  const mode = env.PRINTER_MODE === "tcp" && ip ? "tcp" : "simulate";
  if (mode === "simulate" || !ip) {
    return { ok: true, mode: "simulate", simulated: true, preview: text };
  }
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean, error?: string) => {
      socket.destroy();
      resolve({ ok, mode: "tcp", simulated: false, error, preview: text });
    };
    socket.setTimeout(2500);
    socket.once("timeout", () => done(false, "timeout"));
    socket.once("error", (e) => done(false, e.message));
    socket.connect(9100, ip, () => {
      socket.write(text, "utf8", () => done(true));
    });
  });
}

const line = (s = "") => s.slice(0, WIDTH).padEnd(WIDTH);
const center = (s = "") => {
  const t = s.slice(0, WIDTH);
  const pad = Math.max(0, Math.floor((WIDTH - t.length) / 2));
  return " ".repeat(pad) + t;
};
const cols = (left: string, right: string) => {
  const r = right.slice(0, WIDTH);
  const l = left.slice(0, WIDTH - r.length - 1);
  return l + " ".repeat(Math.max(1, WIDTH - l.length - r.length)) + r;
};

export interface ReceiptData {
  restaurantName: string;
  currency: string;
  header?: string | null;
  footer?: string | null;
  orderNumber: number;
  channel: string;
  tableLabel?: string | null;
  cashier?: string | null;
  createdAt: Date;
  lines: { name: string; qty: number; unit: string; total: string; modifiers?: string[]; voided?: boolean }[];
  subtotal: string;
  discountAmount?: string;
  serviceCharge?: string;
  taxAmount: string;
  total: string;
  payments: { method: string; amount: string }[];
  changeGiven?: string;
  reprint?: boolean;
}

export function buildReceiptText(d: ReceiptData): string {
  const out: string[] = [];
  out.push(center(d.restaurantName));
  if (d.header) out.push(center(d.header));
  out.push(line());
  if (d.reprint) out.push(center("*** REPRINT ***"));
  out.push(cols(`Order #${d.orderNumber}`, d.channel.replace("_", "-")));
  if (d.tableLabel) out.push(cols("Table", d.tableLabel));
  out.push(cols("Date", d.createdAt.toLocaleString()));
  if (d.cashier) out.push(cols("Cashier", d.cashier));
  out.push(line());
  for (const l of d.lines) {
    const tag = l.voided ? "[VOID] " : "";
    out.push(cols(`${tag}${l.qty}x ${l.name}`, l.total));
    if (l.unit && l.qty > 1) out.push(`   @ ${l.unit}`);
    for (const m of l.modifiers ?? []) out.push(`   + ${m}`);
  }
  out.push(line());
  out.push(cols("Subtotal", `${d.currency} ${d.subtotal}`));
  if (d.discountAmount && d.discountAmount !== "0.00") out.push(cols("Discount", `-${d.currency} ${d.discountAmount}`));
  if (d.serviceCharge && d.serviceCharge !== "0.00") out.push(cols("Service", `${d.currency} ${d.serviceCharge}`));
  out.push(cols("Tax", `${d.currency} ${d.taxAmount}`));
  out.push(cols("TOTAL", `${d.currency} ${d.total}`));
  out.push(line());
  for (const p of d.payments) out.push(cols(p.method, `${d.currency} ${p.amount}`));
  if (d.changeGiven && d.changeGiven !== "0.00") out.push(cols("Change", `${d.currency} ${d.changeGiven}`));
  out.push(line());
  out.push(center("Thank you! Please come again."));
  if (d.footer) out.push(center(d.footer));
  out.push("");
  out.push("");
  return out.map((l) => (l.length > WIDTH && !l.startsWith(" ") ? line(l) : l)).join("\n");
}

export function buildKitchenTicketText(t: {
  orderNumber: number;
  station: string;
  tableLabel?: string | null;
  channel: string;
  sentAt: Date;
  lines: { qty: number; name: string; modifiers?: string[]; notes?: string | null }[];
}): string {
  const out: string[] = [];
  out.push(center(`*** ${t.station} ***`));
  out.push(center(`Order #${t.orderNumber}`));
  out.push(cols(t.channel.replace("_", "-"), t.tableLabel ? `Table ${t.tableLabel}` : ""));
  out.push(cols("Sent", t.sentAt.toLocaleTimeString()));
  out.push(line());
  for (const l of t.lines) {
    out.push(`${l.qty}x  ${l.name}`.slice(0, WIDTH));
    for (const m of l.modifiers ?? []) out.push(`    > ${m}`);
    if (l.notes) out.push(`    * ${l.notes}`);
  }
  out.push(line());
  out.push("");
  out.push("");
  return out.join("\n");
}

export function receiptDataToText(preview: string): string {
  return preview;
}

export { fromCents };

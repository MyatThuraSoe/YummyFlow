import net from "node:net";
import { env } from "./env.js";
import { escPosText } from "./escpos.js";

const WIDTH = 32; // chars for a 58mm thermal printer

export interface PrintResult {
  ok: boolean;
  mode: "simulate" | "tcp";
  simulated: boolean;
  error?: string;
  preview: string;
}

/** Send raw ESC/POS bytes (or text wrapped in a complete job) to a network printer. */
export async function sendToPrinter(ip: string | null, payload: string | Buffer, port = 9100): Promise<PrintResult> {
  const mode = env.PRINTER_MODE === "tcp" && ip ? "tcp" : "simulate";
  const preview = Buffer.isBuffer(payload) ? "<esc/pos job>" : payload;
  const bytes = toBytes(payload);
  if (mode === "simulate" || !ip) {
    return { ok: true, mode: "simulate", simulated: true, preview };
  }
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean, error?: string) => {
      socket.destroy();
      resolve({ ok, mode: "tcp", simulated: false, error, preview });
    };
    socket.setTimeout(2500);
    socket.once("timeout", () => done(false, "timeout"));
    socket.once("error", (e) => done(false, e.message));
    socket.connect(port, ip, () => {
      socket.write(bytes, () => done(true));
    });
  });
}

/** Text gets init/codepage/feed/cut unless the install opted into raw UTF-8. */
function toBytes(payload: string | Buffer): Buffer {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload.startsWith("RASTER:")) return Buffer.from(payload.slice("RASTER:".length), "base64");
  if (env.PRINTER_RAW_TEXT) return Buffer.from(payload, "utf8");
  return escPosText(payload, {
    codepage: env.PRINTER_CODEPAGE ?? undefined,
    encoding: env.PRINTER_ENCODING,
    beep: env.PRINTER_BEEP,
  });
}

const line = (s = "") => s.slice(0, WIDTH).padEnd(WIDTH);
const center = (s = "") => {
  const t = s.slice(0, WIDTH);
  const pad = Math.max(0, Math.floor((WIDTH - t.length) / 2));
  return " ".repeat(pad) + t;
};

const TICKET_LABELS: Record<string, { round: string; order: string; table: string; sent: string }> = {
  en: { round: "ROUND", order: "Order", table: "Table", sent: "Sent" },
  my: { round: "အလှည့်", order: "အော်ဒါ", table: "စားပွဲ", sent: "ပို့ပြီး" },
  ja: { round: "ラウンド", order: "注文", table: "テーブル", sent: "送信" },
  th: { round: "รอบ", order: "ออเดอร์", table: "โต๊ะ", sent: "ส่ง" },
  fr: { round: "Tour", order: "Commande", table: "Table", sent: "Envoyé" },
};
/** Wall-clock time in the restaurant's zone (falls back to server zone). */
function formatTime(d: Date, timeZone?: string | null): string {
  try {
    return d.toLocaleTimeString("en-GB", timeZone ? { timeZone } : undefined);
  } catch {
    return d.toLocaleTimeString("en-GB");
  }
}
const cols = (left: string, right: string) => {
  const r = right.slice(0, WIDTH);
  const l = left.slice(0, WIDTH - r.length - 1);
  return l + " ".repeat(Math.max(1, WIDTH - l.length - r.length)) + r;
};

export function buildKitchenTicketText(t: {
  orderNumber: number;
  station: string;
  /** 2+ prints a prominent "ROUND n" line; 1 is the first send. */
  round?: number;
  tableLabel?: string | null;
  channel: string;
  sentAt: Date;
  /** Restaurant zone; without it the server's own zone leaks onto the ticket. */
  timeZone?: string | null;
  /** Ticket language configured for the restaurant; labels only, item names stay as entered. */
  language?: string | null;
  lines: { qty: number; name: string; modifiers?: string[]; notes?: string | null }[];
}): string {
  const labels = TICKET_LABELS[t.language ?? "en"] ?? TICKET_LABELS.en!;
  const out: string[] = [];
  out.push(center(`*** ${t.station} ***`));
  if ((t.round ?? 1) > 1) out.push(center(`${labels.round} ${t.round}`));
  out.push(center(`${labels.order} #${t.orderNumber}`));
  out.push(cols(t.channel.replace("_", "-"), t.tableLabel ? `${labels.table} ${t.tableLabel}` : ""));
  out.push(cols(labels.sent, formatTime(t.sentAt, t.timeZone)));
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

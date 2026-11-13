/**
 * Render a kitchen ticket to a PNG data URL on the device (F-26).
 *
 * Cheap thermal printers only understand a handful of single-byte code pages,
 * so Burmese (and Thai/Japanese) cannot be sent as text. The tablet already has
 * the fonts, so we draw the same ticket the KDS shows and let the backend turn
 * the PNG into an ESC/POS raster.
 */
interface TicketLike {
  station: string;
  round: number;
  sentAt: string;
  order: {
    orderNumber: number;
    channel: string;
    tableId: string | null;
    cashier?: { name: string } | null;
    table?: { number: number; name: string | null } | null;
  };
  lines: { itemName: string; quantity: number; modifiers: { name: string }[] | null; notes: string | null }[];
}

const WIDTH = 384; // 58 mm printer, 203 dpi
const PADDING = 12;
const LINE = 22;

const SCRIPT_FONT = "'Noto Sans Myanmar','Myanmar Text','Pyidaungsu','Noto Sans Thai','Leelawadee UI','Segoe UI',sans-serif";

/** True when the ticket has characters a single-byte codepage cannot print. */
export function needsBitmap(ticket: TicketLike): boolean {
  const text = [
    ticket.station,
    ticket.order.table?.name ?? "",
    ...ticket.lines.map((l) => [l.itemName, l.notes ?? "", ...(l.modifiers ?? []).map((m) => m.name)].join(" ")),
  ].join(" ");
  return /[^\u0020-\u00ff]/.test(text);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}

/** Draw the ticket and return `data:image/png;base64,...` at printer width. */
export function ticketToPng(ticket: TicketLike, labels?: { round?: string; table?: string }): string {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  const measure = canvas.getContext("2d");
  if (!measure) throw new Error("Canvas is not available on this device");
  measure.font = `16px ${SCRIPT_FONT}`;

  const bodyLines: { text: string; bold?: boolean; size?: number }[] = [];
  bodyLines.push({ text: `*** ${ticket.station} ***`, bold: true, size: 20 });
  if (ticket.round > 1) bodyLines.push({ text: `${labels?.round ?? "ROUND"} ${ticket.round}`, bold: true });
  bodyLines.push({ text: `Order #${ticket.order.orderNumber}` });
  if (ticket.order.table) {
    bodyLines.push({ text: `${labels?.table ?? "Table"} ${ticket.order.table.name ?? ticket.order.table.number}` });
  }
  if (ticket.order.cashier?.name) bodyLines.push({ text: ticket.order.cashier.name });
  bodyLines.push({ text: new Date(ticket.sentAt).toLocaleString() });
  bodyLines.push({ text: "" });
  for (const line of ticket.lines) {
    for (const row of wrap(measure, `${line.quantity}x ${line.itemName}`, WIDTH - PADDING * 2)) {
      bodyLines.push({ text: row, bold: true });
    }
    for (const modifier of line.modifiers ?? []) bodyLines.push({ text: `  + ${modifier.name}` });
    if (line.notes) bodyLines.push({ text: `  * ${line.notes}` });
  }

  canvas.height = PADDING * 2 + bodyLines.length * LINE + 40;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available on this device");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  let y = PADDING;
  for (const row of bodyLines) {
    ctx.font = `${row.bold ? "bold " : ""}${row.size ?? 16}px ${SCRIPT_FONT}`;
    ctx.fillText(row.text, PADDING, y);
    y += LINE;
  }
  ctx.textAlign = "center";
  ctx.fillText("— — — — — — — — — — — — —", WIDTH / 2, y + 6);

  return canvas.toDataURL("image/png");
}

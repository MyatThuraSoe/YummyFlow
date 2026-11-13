import type { Station } from "@prisma/client";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { sendToPrinter, type PrintResult } from "./printers.js";

const MAX_ATTEMPTS = 6;
const RETRY_BASE_MS = 30_000;

interface JobInput {
  restaurantId: string;
  orderId?: string | null;
  ticketId?: string | null;
  kind: "KITCHEN" | "REPRINT" | "RECEIPT";
  station?: Station | null;
  text: string;
  /** Pre-built ESC/POS bytes; stored as a `RASTER:` payload on the job. */
  raster?: Buffer | null;
}

/**
 * Resolve the printer for a station, falling back to the env values so an
 * existing install keeps working before the owner fills in the printer table.
 */
export async function printerFor(restaurantId: string, station?: Station | null) {
  if (station) {
    const configured = await prisma.stationPrinter.findUnique({
      where: { restaurantId_station: { restaurantId, station } },
    });
    if (configured?.isActive && configured.ip) return { ip: configured.ip, port: configured.port };
    return { ip: env.KITCHEN_PRINTER_IP || null, port: 9100 };
  }
  return { ip: env.RECEIPT_PRINTER_IP || null, port: 9100 };
}

async function attempt(jobId: string): Promise<PrintResult> {
  const job = await prisma.printJob.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, mode: "simulate", simulated: true, error: "job not found", preview: "" };
  const result = await sendToPrinter(job.printerIp, job.payload, job.port ?? 9100);
  const attempts = job.attempts + 1;
  if (result.ok) {
    await prisma.printJob.update({
      where: { id: job.id },
      data: { status: "SENT", attempts, sentAt: new Date(), lastError: null },
    });
  } else {
    const delay = Math.min(RETRY_BASE_MS * attempts, 10 * 60_000);
    await prisma.printJob.update({
      where: { id: job.id },
      data: {
        status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
        attempts,
        lastError: result.error ?? "print failed",
        nextAttemptAt: new Date(Date.now() + delay),
      },
    });
  }
  return result;
}

/** Persist a print job and try it immediately. A failed job is retried later. */
export async function queuePrint(input: JobInput) {
  const printer = await printerFor(input.restaurantId, input.station ?? null);
  const job = await prisma.printJob.create({
    data: {
      restaurantId: input.restaurantId,
      orderId: input.orderId ?? null,
      ticketId: input.ticketId ?? null,
      kind: input.kind,
      station: input.station ?? null,
      printerIp: printer.ip,
      port: printer.port,
      payload: input.raster ? `RASTER:${input.raster.toString("base64")}` : input.text,
    },
  });
  const result = await attempt(job.id);
  return { job, result };
}

/** Re-send an existing payload as a new job; used by the Reprint button. */
export async function reprintJob(jobId: string, restaurantId: string) {
  const source = await prisma.printJob.findFirst({ where: { id: jobId, restaurantId } });
  if (!source) return null;
  return queuePrint({
    restaurantId,
    orderId: source.orderId,
    ticketId: source.ticketId,
    kind: "REPRINT",
    station: source.station,
    text: source.payload,
  });
}

/** Process every due job; exported so verification can drive it deterministically. */
export async function runDuePrintJobs() {
  const due = await prisma.printJob.findMany({
    where: {
      status: "PENDING",
      attempts: { lt: MAX_ATTEMPTS },
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: 20,
  });
  let sent = 0;
  let failed = 0;
  for (const job of due) {
    const result = await attempt(job.id);
    if (result.ok) sent += 1;
    else failed += 1;
  }
  return { checked: due.length, sent, failed };
}

let timer: NodeJS.Timeout | null = null;

export function startPrintWorker() {
  if (timer) return timer;
  timer = setInterval(() => {
    void runDuePrintJobs().catch((e) => console.warn("[print] retry worker failed:", e instanceof Error ? e.message : e));
  }, 30_000);
  timer.unref?.();
  return timer;
}

export function stopPrintWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

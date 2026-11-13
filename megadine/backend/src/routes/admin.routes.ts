import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit } from "../lib/audit.js";
import { backupStatus, exportToUsb, listBackupFiles, listBackups, restoreFromSql, runBackup } from "../lib/backup.js";
import { sendToPrinter } from "../lib/printers.js";
import { printerFor, reprintJob } from "../lib/printQueue.js";
import type { Station } from "@prisma/client";
import { env } from "../lib/env.js";
import { toCents } from "../lib/money.js";
import { assertWithinLimit, limitUsage } from "../lib/license.js";
import { isValidTimeZone, setBusinessTimezone } from "../lib/businessDay.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

// Staff accounts are managed by /users (single source of truth). The old
// /admin/users aliases were removed so a role change cannot bypass the guards.

// ── Audit log ───────────────────────────────────────────
adminRouter.get(
  "/audit",
  requirePermission("audit.view"),
  asyncHandler(async (req, res) => {
    const { action, userId, limit, from, to } = req.query as Record<string, string | undefined>;
    const logs = await prisma.auditLog.findMany({
      where: {
        restaurantId: req.auth!.restaurantId,
        ...(action ? { action } : {}),
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      },
      include: { user: { select: { name: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: limit ? Math.min(Number(limit), 500) : 100,
    });
    res.json({ logs });
  }),
);

// ── Settings ────────────────────────────────────────────
adminRouter.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const restaurant = await prisma.restaurant.findUnique({ where: { id: req.auth!.restaurantId } });
    res.json({ restaurant });
  }),
);

const settingsSchema = z.object({
  name: z.string().min(1).optional(),
  currency: z.string().min(1).max(8).optional(),
  businessDayCutoff: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().min(1).max(60).refine((v) => isValidTimeZone(v), "Unknown time zone").optional(),
  ticketLanguage: z.enum(["en", "my", "ja", "th", "fr"]).optional(),
  taxRate: z.number().min(0).max(1).optional(),
  taxInclusive: z.boolean().optional(),
  serviceChargePct: z.number().min(0).max(1).optional(),
  receiptHeader: z.string().max(120).nullable().optional(),
  receiptFooter: z.string().max(120).nullable().optional(),
  cashVarianceTolerance: z.number().min(0).max(10000).optional(),
  address: z.string().max(200).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email().nullable().optional(),
  taxId: z.string().max(60).nullable().optional(),
  logo: z.string().max(500).nullable().optional(),
});

adminRouter.patch(
  "/settings",
  requirePermission("settings.manage"),
  validate({ body: settingsSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof settingsSchema>;
    const restaurant = await prisma.restaurant.update({
      where: { id: req.auth!.restaurantId },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.currency !== undefined ? { currency: b.currency } : {}),
        ...(b.businessDayCutoff !== undefined ? { businessDayCutoff: b.businessDayCutoff } : {}),
        ...(b.timezone !== undefined ? { timezone: b.timezone } : {}),
        ...(b.ticketLanguage !== undefined ? { ticketLanguage: b.ticketLanguage } : {}),
        ...(b.taxRate !== undefined ? { taxRate: b.taxRate.toFixed(4) } : {}),
        ...(b.taxInclusive !== undefined ? { taxInclusive: b.taxInclusive } : {}),
        ...(b.serviceChargePct !== undefined ? { serviceChargePct: b.serviceChargePct.toFixed(4) } : {}),
        ...(b.receiptHeader !== undefined ? { receiptHeader: b.receiptHeader } : {}),
        ...(b.receiptFooter !== undefined ? { receiptFooter: b.receiptFooter } : {}),
        ...(b.cashVarianceTolerance !== undefined ? { cashVarianceTolerance: b.cashVarianceTolerance.toFixed(2) } : {}),
        ...(b.address !== undefined ? { address: b.address } : {}),
        ...(b.phone !== undefined ? { phone: b.phone } : {}),
        ...(b.email !== undefined ? { email: b.email } : {}),
        ...(b.taxId !== undefined ? { taxId: b.taxId } : {}),
        ...(b.logo !== undefined ? { logo: b.logo } : {}),
      },
    });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "SETTINGS_UPDATED", entityType: "Restaurant", entityId: restaurant.id, after: b });
    if (b.timezone !== undefined) setBusinessTimezone(restaurant.timezone);
    res.json({ restaurant });
  }),
);

// ── Terminals / hardware ────────────────────────────────
adminRouter.get(
  "/terminals",
  asyncHandler(async (req, res) => {
    const terminals = await prisma.terminal.findMany({ where: { restaurantId: req.auth!.restaurantId } });
    res.json({ terminals });
  }),
);

const terminalSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["POS", "KDS", "TABLET", "DISPLAY"]),
  printerIP: z.string().max(60).optional().nullable(),
  drawerEnabled: z.boolean().optional(),
});

adminRouter.post(
  "/terminals",
  requirePermission("hardware.manage"),
  validate({ body: terminalSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof terminalSchema>;
    assertWithinLimit("terminals", await prisma.terminal.count({ where: { restaurantId: req.auth!.restaurantId } }));
    const terminal = await prisma.terminal.create({
      data: { restaurantId: req.auth!.restaurantId, name: b.name, type: b.type, printerIP: b.printerIP ?? null, drawerEnabled: b.drawerEnabled ?? false },
    });
    res.status(201).json({ terminal });
  }),
);

adminRouter.get(
  "/hardware/status",
  asyncHandler(async (req, res) => {
    const [printers, pending, failed] = await Promise.all([
      prisma.stationPrinter.findMany({
        where: { restaurantId: req.auth!.restaurantId },
        select: { station: true, ip: true, port: true, isActive: true },
      }),
      prisma.printJob.count({ where: { restaurantId: req.auth!.restaurantId, status: "PENDING" } }),
      prisma.printJob.count({ where: { restaurantId: req.auth!.restaurantId, status: "FAILED" } }),
    ]);
    res.json({
      printerMode: env.PRINTER_MODE,
      receiptPrinter: env.RECEIPT_PRINTER_IP || "(simulated)",
      kitchenPrinter: env.KITCHEN_PRINTER_IP || "(simulated)",
      simulateMode: env.PRINTER_MODE !== "tcp",
      stationPrinters: printers,
      printQueue: { pending, failed },
    });
  }),
);

const stationPrinterSchema = z.object({
  station: z.enum(["GRILL", "FRYER", "SALAD", "BAR", "DESSERT", "KITCHEN"]),
  name: z.string().min(1).max(60),
  ip: z.string().min(1).max(60),
  port: z.number().int().min(1).max(65535).optional(),
  isActive: z.boolean().optional(),
});

adminRouter.get(
  "/printers",
  requirePermission("hardware.manage"),
  asyncHandler(async (req, res) => {
    const printers = await prisma.stationPrinter.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      orderBy: { station: "asc" },
    });
    res.json({ printers });
  }),
);

adminRouter.post(
  "/printers",
  requirePermission("hardware.manage"),
  validate({ body: stationPrinterSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof stationPrinterSchema>;
    const printer = await prisma.stationPrinter.upsert({
      where: { restaurantId_station: { restaurantId: req.auth!.restaurantId, station: b.station } },
      create: {
        restaurantId: req.auth!.restaurantId,
        station: b.station,
        name: b.name,
        ip: b.ip,
        port: b.port ?? 9100,
        isActive: b.isActive ?? true,
      },
      update: { name: b.name, ip: b.ip, port: b.port ?? 9100, isActive: b.isActive ?? true },
    });
    await audit({
      restaurantId: req.auth!.restaurantId,
      userId: req.auth!.userId,
      action: "STATION_PRINTER_SAVED",
      entityType: "StationPrinter",
      entityId: printer.id,
      after: { station: printer.station, ip: printer.ip, port: printer.port, isActive: printer.isActive },
    });
    res.status(201).json({ printer });
  }),
);

const stationPrinterPatch = stationPrinterSchema.partial();

adminRouter.patch(
  "/printers/:id",
  requirePermission("hardware.manage"),
  validate({ body: stationPrinterPatch }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof stationPrinterPatch>;
    const existing = await prisma.stationPrinter.findFirst({
      where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId },
    });
    if (!existing) throw ApiError.notFound("Printer not found");
    const printer = await prisma.stationPrinter.update({
      where: { id: existing.id },
      data: {
        ...(b.station !== undefined ? { station: b.station } : {}),
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.ip !== undefined ? { ip: b.ip } : {}),
        ...(b.port !== undefined ? { port: b.port } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
    });
    res.json({ printer });
  }),
);

adminRouter.delete(
  "/printers/:id",
  requirePermission("hardware.manage"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.stationPrinter.findFirst({
      where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId },
    });
    if (!existing) throw ApiError.notFound("Printer not found");
    await prisma.stationPrinter.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/print-jobs",
  requirePermission("hardware.manage"),
  asyncHandler(async (req, res) => {
    const status = (req.query.status as string | undefined) ?? undefined;
    const jobs = await prisma.printJob.findMany({
      where: {
        restaurantId: req.auth!.restaurantId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        kind: true,
        station: true,
        status: true,
        attempts: true,
        lastError: true,
        printerIp: true,
        createdAt: true,
        sentAt: true,
        ticketId: true,
        orderId: true,
      },
    });
    res.json({ jobs });
  }),
);

adminRouter.get(
  "/license",
  asyncHandler(async (req, res) => {
    res.json(await limitUsage(req.auth!.restaurantId));
  }),
);

adminRouter.post(
  "/hardware/test-print",
  requirePermission("hardware.manage"),
  asyncHandler(async (req, res) => {
    const target = (req.query.target as string) ?? "receipt";
    const station = req.query.station as string | undefined;
    const printer = station
      ? await printerFor(req.auth!.restaurantId, station as Station)
      : { ip: target === "kitchen" ? env.KITCHEN_PRINTER_IP : env.RECEIPT_PRINTER_IP, port: 9100 };
    const result = await sendToPrinter(
      printer.ip || null,
      `\nMegaDine test print (${station ?? target})\n${new Date().toLocaleString()}\n\n\n`,
      printer.port ?? 9100,
    );
    res.json(result);
  }),
);

adminRouter.post(
  "/print-jobs/:id/reprint",
  requirePermission("hardware.manage"),
  asyncHandler(async (req, res) => {
    const print = await reprintJob(String(req.params.id), req.auth!.restaurantId);
    if (!print) throw ApiError.notFound("Print job not found");
    res.json({ job: print.job, ok: print.result.ok, simulated: print.result.simulated, error: print.result.error ?? null });
  }),
);

// ── Backups ─────────────────────────────────────────────
adminRouter.get(
  "/backup/status",
  requirePermission("backup.manage"),
  asyncHandler(async (req, res) => {
    const status = await backupStatus();
    const runs = await listBackups(req.auth!.restaurantId);
    res.json({ ...status, runs });
  }),
);

adminRouter.post(
  "/backup/run",
  requirePermission("backup.manage"),
  asyncHandler(async (req, res) => {
    const kind = (req.query.kind as "MANUAL" | "USB") ?? "MANUAL";
    const rec = await runBackup({ restaurantId: req.auth!.restaurantId, kind, actorId: req.auth!.userId });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "BACKUP_RUN", entityType: "BackupRun", entityId: rec.id, after: { status: rec.status, file: rec.file } });
    res.status(201).json({ backup: rec });
  }),
);

adminRouter.post(
  "/backup/export",
  requirePermission("backup.manage"),
  asyncHandler(async (req, res) => {
    const rec = await exportToUsb({ restaurantId: req.auth!.restaurantId, actorId: req.auth!.userId });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "BACKUP_USB_EXPORT", entityType: "BackupRun", entityId: rec.id, after: { status: rec.status, file: rec.file } });
    res.status(201).json({ backup: rec, usbDir: env.USB_EXPORT_DIR || null });
  }),
);

adminRouter.get(
  "/backup/files",
  requirePermission("backup.manage"),
  asyncHandler(async (_req, res) => {
    res.json({ files: await listBackupFiles() });
  }),
);

const restoreSchema = z.object({ file: z.string().min(1), confirm: z.literal(true) });

adminRouter.post(
  "/backup/restore",
  requirePermission("backup.manage"),
  validate({ body: restoreSchema }),
  asyncHandler(async (req, res) => {
    const { file } = req.body as z.infer<typeof restoreSchema>;
    const result = await restoreFromSql(file, req.auth!.userId);
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "BACKUP_RESTORED", entityType: "BackupRun", entityId: file, after: result });
    res.json(result);
  }),
);

void toCents;

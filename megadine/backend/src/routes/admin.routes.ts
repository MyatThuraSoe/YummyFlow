import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit } from "../lib/audit.js";
import { hashPin, isValidPinFormat } from "../lib/auth.js";
import { backupStatus, exportToUsb, listBackupFiles, listBackups, restoreFromSql, runBackup } from "../lib/backup.js";
import { sendToPrinter } from "../lib/printers.js";
import { env } from "../lib/env.js";
import { toCents } from "../lib/money.js";
import { assertWithinLimit, limitUsage } from "../lib/license.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

// ── Staff ───────────────────────────────────────────────
adminRouter.get(
  "/users",
  requirePermission("staff.manage"),
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { name: "asc" },
    });
    res.json({ users });
  }),
);

const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  role: z.enum(["OWNER", "ADMIN", "CASHIER", "WAITER", "KITCHEN"]),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  password: z.string().min(6).optional(),
});

adminRouter.post(
  "/users",
  requirePermission("staff.manage"),
  validate({ body: userSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof userSchema>;
    if (b.pin && !isValidPinFormat(b.pin)) throw ApiError.badRequest("PIN must be 4-6 digits");
    const user = await prisma.user.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        name: b.name,
        email: b.email ?? null,
        role: b.role,
        pinHash: b.pin ? await hashPin(b.pin) : null,
      },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "STAFF_CREATED", entityType: "User", entityId: user.id, after: { role: b.role } });
    res.status(201).json({ user });
  }),
);

const userPatchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  role: z.enum(["OWNER", "ADMIN", "CASHIER", "WAITER", "KITCHEN"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

adminRouter.patch(
  "/users/:id",
  requirePermission("staff.manage"),
  validate({ body: userPatchSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof userPatchSchema>;
    const user = await prisma.user.update({
      where: { id: String(req.params.id) },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.email !== undefined ? { email: b.email } : {}),
        ...(b.role !== undefined ? { role: b.role } : {}),
        ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
      },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "STAFF_UPDATED", entityType: "User", entityId: user.id });
    res.json({ user });
  }),
);

adminRouter.post(
  "/users/:id/reset-pin",
  requirePermission("staff.manage"),
  validate({ body: z.object({ pin: z.string().regex(/^\d{4,6}$/) }) }),
  asyncHandler(async (req, res) => {
    const { pin } = req.body as { pin: string };
    await prisma.user.update({ where: { id: String(req.params.id) }, data: { pinHash: await hashPin(pin) } });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "STAFF_PIN_RESET", entityType: "User", entityId: String(req.params.id) });
    res.json({ ok: true });
  }),
);

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
  asyncHandler(async (_req, res) => {
    res.json({
      printerMode: env.PRINTER_MODE,
      receiptPrinter: env.RECEIPT_PRINTER_IP || "(simulated)",
      kitchenPrinter: env.KITCHEN_PRINTER_IP || "(simulated)",
      simulateMode: env.PRINTER_MODE !== "tcp",
    });
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
    const ip = target === "kitchen" ? env.KITCHEN_PRINTER_IP : env.RECEIPT_PRINTER_IP;
    const result = await sendToPrinter(ip || null, `\nMegaDine test print (${target})\n${new Date().toLocaleString()}\n\n\n`);
    res.json(result);
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

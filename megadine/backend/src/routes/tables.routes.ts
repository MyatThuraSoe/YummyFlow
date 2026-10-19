import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit } from "../lib/audit.js";
import { assertWithinLimit } from "../lib/license.js";
import { EVENTS, emitToWorkspace } from "../lib/socket.js";

export const tablesRouter = Router();
tablesRouter.use(requireAuth);

tablesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const tables = await prisma.restaurantTable.findMany({
      where: { restaurantId: req.auth!.restaurantId, isActive: true },
      orderBy: { number: "asc" },
      include: {
        sessions: {
          where: { status: "OPEN" },
          include: { order: { include: { lines: { where: { isVoided: false } } } } },
        },
      },
    });
    const view = tables.map((t) => {
      const session = t.sessions[0] ?? null;
      const order = session?.order ?? null;
      const itemCount = order?.lines.reduce((s, l) => s + l.quantity, 0) ?? 0;
      return {
        ...t,
        sessions: undefined,
        current: session
          ? {
              sessionId: session.id,
              openedAt: session.openedAt,
              orderId: order?.id ?? null,
              orderNumber: order?.orderNumber ?? null,
              total: order?.total ?? "0",
              itemCount,
              status: order?.status ?? null,
            }
          : null,
      };
    });
    res.json({ tables: view });
  }),
);

const createSchema = z.object({
  number: z.number().int().min(1),
  name: z.string().max(40).optional().nullable(),
  capacity: z.number().int().min(1).max(50).optional(),
  zone: z.string().max(40).optional(),
  positionX: z.number().int().optional().nullable(),
  positionY: z.number().int().optional().nullable(),
});

tablesRouter.post(
  "/",
  requirePermission("table.manage"),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    assertWithinLimit("tables", await prisma.restaurantTable.count({ where: { restaurantId: req.auth!.restaurantId, isActive: true } }));
    const table = await prisma.restaurantTable.create({
      data: { restaurantId: req.auth!.restaurantId, number: body.number, name: body.name ?? null, capacity: body.capacity ?? 4, zone: body.zone ?? "Main", positionX: body.positionX ?? null, positionY: body.positionY ?? null },
    });
    emitToWorkspace(EVENTS.TABLE_UPDATED, { tableId: table.id });
    res.status(201).json({ table });
  }),
);

const patchSchema = createSchema.partial().extend({
  status: z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "NEEDS_BILL", "NEEDS_CLEANING", "OUT_OF_SERVICE"]).optional(),
  version: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

tablesRouter.patch(
  "/:id",
  requirePermission("table.manage"),
  validate({ body: patchSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof patchSchema>;
    const { version, ...data } = body;
    const existing = await prisma.restaurantTable.findFirst({
      where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId },
    });
    if (!existing) throw ApiError.notFound("Table not found");
    if (version !== undefined && version !== existing.version) {
      throw new ApiError(409, "STALE", "Table was updated by someone else. Reload and try again.");
    }
    const table = await prisma.restaurantTable.update({
      where: { id: String(req.params.id) },
      data: { ...data, version: { increment: 1 } },
    });
    if (data.status === "NEEDS_BILL") {
      await prisma.tableSession.updateMany({
        where: { tableId: table.id, status: "OPEN" },
        data: { billRequestedAt: new Date() },
      });
    }
    emitToWorkspace(EVENTS.TABLE_UPDATED, { tableId: table.id, status: table.status });
    res.json({ table });
  }),
);

const statusSchema = z.object({
  status: z.enum(["AVAILABLE", "OCCUPIED", "RESERVED", "NEEDS_BILL", "NEEDS_CLEANING", "OUT_OF_SERVICE"]),
});

tablesRouter.post(
  "/:id/status",
  requirePermission("table.manage"),
  validate({ body: statusSchema }),
  asyncHandler(async (req, res) => {
    const { status } = req.body as z.infer<typeof statusSchema>;
    const table = await prisma.restaurantTable.update({
      where: { id: String(req.params.id) },
      data: { status, version: { increment: 1 } },
    });
    if (status === "NEEDS_BILL") {
      await prisma.tableSession.updateMany({
        where: { tableId: table.id, status: "OPEN" },
        data: { billRequestedAt: new Date() },
      });
    }
    emitToWorkspace(EVENTS.TABLE_UPDATED, { tableId: table.id, status });
    res.json({ table });
  }),
);

/** Clear a table: close any open session (e.g. after the bill is settled). */
tablesRouter.post(
  "/:id/clear",
  requirePermission("table.manage"),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.findFirst({
      where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId },
    });
    if (!table) throw ApiError.notFound("Table not found");
    const open = await prisma.tableSession.findFirst({
      where: { tableId: table.id, status: "OPEN" },
      include: { order: { select: { orderNumber: true, status: true } } },
    });
    if (open?.order && open.order.status !== "COMPLETED" && open.order.status !== "CANCELLED") {
      throw ApiError.conflict(`Table has an open order #${open.order.orderNumber}. Pay or cancel it first.`);
    }
    await prisma.$transaction([
      prisma.tableSession.updateMany({
        where: { tableId: table.id, status: "OPEN" },
        data: { status: "CLOSED", closedAt: new Date(), clearedAt: new Date() },
      }),
      prisma.restaurantTable.update({ where: { id: table.id }, data: { status: "AVAILABLE", version: { increment: 1 } } }),
    ]);
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "TABLE_CLEARED", entityType: "RestaurantTable", entityId: table.id });
    emitToWorkspace(EVENTS.TABLE_UPDATED, { tableId: table.id, status: "AVAILABLE" });
    res.json({ ok: true });
  }),
);

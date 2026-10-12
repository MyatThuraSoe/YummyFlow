import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError, asyncHandler } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validate } from "../middleware/validate.js";
import { audit } from "../lib/audit.js";
import { fromCents, toCents } from "../lib/money.js";
import { endOfDay, startOfDay } from "../lib/businessDay.js";
import { addCashMovement, currentOpenShift } from "../services/shift.service.js";

export const expensesRouter = Router();
expensesRouter.use(requireAuth);

expensesRouter.get(
  "/",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    const now = new Date();
    const start = from ? startOfDay(new Date(from)) : startOfDay(now);
    const end = to ? endOfDay(new Date(to)) : endOfDay(now);
    const expenses = await prisma.expense.findMany({
      where: { restaurantId: req.auth!.restaurantId, date: { gte: start, lte: end } },
      orderBy: { date: "desc" },
    });
    const total = expenses.reduce((s, e) => s + toCents(e.amount), 0);
    res.json({ expenses, total });
  }),
);

const expenseSchema = z.object({
  date: z.string().datetime().optional(),
  category: z.string().min(1),
  amount: z.number().positive(),
  payee: z.string().max(120).optional(),
  paymentMethod: z.string().max(40).optional(),
  receiptRef: z.string().max(120).optional(),
  notes: z.string().max(300).optional(),
  fromDrawer: z.boolean().optional(),
  shiftId: z.string().uuid().optional(),
});

expensesRouter.post(
  "/",
  requirePermission("expense.manage"),
  validate({ body: expenseSchema }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof expenseSchema>;
    const amountCents = toCents(b.amount);

    let shiftId: string | null = null;
    if (b.fromDrawer || b.paymentMethod === "CASH_DRAWER") {
      const shift = b.shiftId
        ? await prisma.cashShift.findFirst({ where: { id: b.shiftId, restaurantId: req.auth!.restaurantId, status: "OPEN" } })
        : await currentOpenShift(req.auth!.restaurantId, req.auth!.userId);
      if (!shift) throw ApiError.badRequest("No open shift to pay this expense from the drawer");
      shiftId = shift.id;
    }

    const expense = await prisma.expense.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        date: b.date ? new Date(b.date) : new Date(),
        category: b.category,
        amount: fromCents(amountCents),
        payee: b.payee,
        paymentMethod: shiftId ? "CASH_DRAWER" : b.paymentMethod,
        receiptRef: b.receiptRef,
        notes: b.notes,
        actorId: req.auth!.userId,
        shiftId,
      },
    });

    if (shiftId) {
      await addCashMovement({
        shiftId,
        actorId: req.auth!.userId,
        type: "PAID_OUT",
        amount: amountCents,
        reason: `Expense: ${expense.category}${expense.payee ? ` (${expense.payee})` : ""}`,
      });
    }

    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "EXPENSE_RECORDED", entityType: "Expense", entityId: expense.id, after: { amount: expense.amount.toString(), fromDrawer: Boolean(shiftId) } });
    res.status(201).json({ expense });
  }),
);

expensesRouter.delete(
  "/:id",
  requirePermission("expense.manage"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.expense.findFirst({ where: { id: String(req.params.id), restaurantId: req.auth!.restaurantId } });
    await prisma.expense.delete({ where: { id: String(req.params.id) } });
    await audit({ restaurantId: req.auth!.restaurantId, userId: req.auth!.userId, action: "EXPENSE_DELETED", entityType: "Expense", entityId: String(req.params.id), before: existing ? { amount: existing.amount.toString() } : null });
    res.json({ ok: true });
  }),
);

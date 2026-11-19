import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { businessDateFor, dateKey, zonedParts } from "../lib/businessDay.js";
import { pinLookup } from "../lib/auth.js";

/** Default windows used to flag late arrivals / early departures. */
const DEFAULT_WINDOW = { start: 8 * 60, end: 16 * 60 };
const SHIFT_WINDOWS: Record<string, { start: number; end: number }> = {
  MORNING: DEFAULT_WINDOW,
  EVENING: { start: 14 * 60, end: 22 * 60 },
  NIGHT: { start: 18 * 60, end: 26 * 60 },
};

function minutesOfDay(instant: Date, timezone: string): number {
  const p = zonedParts(instant, timezone);
  return p.h * 60 + p.min;
}

/** A known shift window, or the morning default for an unknown value. */
function windowFor(shift: string | null | undefined): { start: number; end: number } {
  return SHIFT_WINDOWS[shift ?? "MORNING"] ?? DEFAULT_WINDOW;
}

async function context(restaurantId: string) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { timezone: true, businessDayCutoff: true },
  });
  return {
    timezone: restaurant?.timezone ?? "UTC",
    cutoff: restaurant?.businessDayCutoff ?? "04:00",
  };
}

function dayFor(instant: Date, cutoff: string, timezone: string): Date {
  return businessDateFor(instant, cutoff, timezone);
}

async function employeeFromPin(restaurantId: string, pin: string) {
  const user = await prisma.user.findFirst({
    where: { restaurantId, pinLookup: pinLookup(restaurantId, pin), deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (!user) throw ApiError.unauthorized("Invalid PIN");
  const employee = await prisma.employee.findFirst({
    where: { restaurantId, userId: user.id, status: "ACTIVE" },
  });
  if (!employee) throw ApiError.badRequest("This login has no active employee record");
  return employee;
}

export async function clockIn(input: {
  restaurantId: string;
  pin: string;
  terminalId?: string | null;
}) {
  const { timezone, cutoff } = await context(input.restaurantId);
  const employee = await employeeFromPin(input.restaurantId, input.pin);
  const now = new Date();
  const businessDate = dayFor(now, cutoff, timezone);
  const existing = await prisma.attendance.findUnique({
    where: { employeeId_businessDate: { employeeId: employee.id, businessDate } },
  });
  if (existing && !existing.clockOut) throw ApiError.conflict("Already clocked in for this shift");

  const dayOfWeek = businessDate.getUTCDay();
  const roster = await prisma.rosterShift.findFirst({
    where: { restaurantId: input.restaurantId, employeeId: employee.id, dayOfWeek },
  });
  const window = windowFor(roster?.shift);
  const nowMin = minutesOfDay(now, timezone);
  const lateMinutes = Math.max(0, nowMin - window.start);

  if (existing) {
    return prisma.attendance.update({
      where: { id: existing.id },
      data: { clockIn: now, clockOut: null, lateMinutes, method: "PIN", terminalId: input.terminalId ?? null, editedById: null, editReason: null },
    });
  }
  return prisma.attendance.create({
    data: {
      restaurantId: input.restaurantId,
      employeeId: employee.id,
      businessDate,
      clockIn: now,
      lateMinutes,
      method: "PIN",
      terminalId: input.terminalId ?? null,
    },
  });
}

export async function clockOut(input: {
  restaurantId: string;
  pin: string;
  terminalId?: string | null;
}) {
  const { timezone, cutoff } = await context(input.restaurantId);
  const employee = await employeeFromPin(input.restaurantId, input.pin);
  const now = new Date();
  const businessDate = dayFor(now, cutoff, timezone);
  const record = await prisma.attendance.findUnique({
    where: { employeeId_businessDate: { employeeId: employee.id, businessDate } },
    include: { employee: true },
  });
  if (!record) throw ApiError.notFound("No clock-in found for today");
  if (record.clockOut) throw ApiError.conflict("Already clocked out for this shift");

  const roster = await prisma.rosterShift.findFirst({
    where: {
      restaurantId: input.restaurantId,
      employeeId: employee.id,
      dayOfWeek: businessDate.getUTCDay(),
    },
  });
  const window = windowFor(roster?.shift);
  let nowMin = minutesOfDay(now, timezone);
  if (window.end > 24 * 60 && nowMin < 12 * 60) nowMin += 24 * 60; // night shift past midnight
  const earlyMinutes = Math.max(0, window.end - nowMin);

  return prisma.attendance.update({
    where: { id: record.id },
    data: {
      clockOut: now,
      earlyMinutes,
      method: "PIN",
      terminalId: input.terminalId ?? null,
    },
  });
}

/** Compute and store a day's tip split using the requested rule. */
export async function saveTipEntry(input: {
  restaurantId: string;
  businessDate: Date;
  tipAmount: number; // major units
  serviceCharge: number; // major units
  rule: "EQUAL" | "HOURS" | "POINTS";
  points?: Record<string, number>;
  enteredById: string;
}) {
  const { timezone, cutoff } = await context(input.restaurantId);
  const day = dayFor(input.businessDate, cutoff, timezone);
  const employees = await prisma.employee.findMany({
    where: { restaurantId: input.restaurantId, status: "ACTIVE" },
    select: { id: true },
  });
  if (employees.length === 0) throw ApiError.badRequest("No active employees to allocate tips to");

  const attendance = await prisma.attendance.findMany({
    where: { restaurantId: input.restaurantId, businessDate: day },
    select: { employeeId: true, clockIn: true, clockOut: true, breakMinutes: true },
  });
  const hours = new Map<string, number>();
  for (const a of attendance) {
    const end = a.clockOut ?? new Date();
    const worked = Math.max(0, (end.getTime() - a.clockIn.getTime()) / 3_600_000 - a.breakMinutes / 60);
    hours.set(a.employeeId, (hours.get(a.employeeId) ?? 0) + worked);
  }

  const weights = new Map<string, number>();
  for (const e of employees) {
    let weight = 1;
    if (input.rule === "HOURS") weight = hours.get(e.id) ?? 0;
    if (input.rule === "POINTS") weight = Math.max(0, input.points?.[e.id] ?? 0);
    weights.set(e.id, weight);
  }
  const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) throw ApiError.badRequest("No hours or points available for this allocation rule");

  const total = Math.round((input.tipAmount + input.serviceCharge) * 100);
  const allocations: { employeeId: string; amount: number }[] = [];
  let assigned = 0;
  for (const e of employees) {
    const share = Math.round(total * ((weights.get(e.id) ?? 0) / totalWeight));
    allocations.push({ employeeId: e.id, amount: share / 100 });
    assigned += share;
  }
  // Give any rounding remainder to the first employee.
  const first = allocations[0];
  if (assigned !== total && first) {
    first.amount = Math.round((first.amount * 100 + (total - assigned))) / 100;
  }

  return prisma.tipEntry.upsert({
    where: { restaurantId_businessDate: { restaurantId: input.restaurantId, businessDate: day } },
    create: {
      restaurantId: input.restaurantId,
      businessDate: day,
      tipAmount: input.tipAmount,
      serviceCharge: input.serviceCharge,
      rule: input.rule,
      allocations: allocations as object,
      enteredById: input.enteredById,
    },
    update: {
      tipAmount: input.tipAmount,
      serviceCharge: input.serviceCharge,
      rule: input.rule,
      allocations: allocations as object,
      enteredById: input.enteredById,
    },
  });
}

/** Pay sheet for a period. The app never pays anyone — it only computes. */
export async function paySummary(restaurantId: string, from: Date, to: Date) {
  const { timezone, cutoff } = await context(restaurantId);
  const [employees, attendance, advances, deductions, tips, meals] = await Promise.all([
    prisma.employee.findMany({ where: { restaurantId }, orderBy: [{ status: "asc" }, { firstName: "asc" }] }),
    prisma.attendance.findMany({ where: { restaurantId, businessDate: { gte: from, lte: to } } }),
    prisma.staffAdvance.findMany({ where: { restaurantId, businessDate: { gte: from, lte: to } } }),
    prisma.staffDeduction.findMany({ where: { restaurantId, businessDate: { gte: from, lte: to } } }),
    prisma.tipEntry.findMany({ where: { restaurantId, businessDate: { gte: from, lte: to } } }),
    prisma.staffMeal.findMany({ where: { restaurantId, businessDate: { gte: from, lte: to } } }),
  ]);

  const tipByEmployee = new Map<string, number>();
  for (const entry of tips) {
    for (const a of (entry.allocations ?? []) as { employeeId: string; amount: number }[]) {
      tipByEmployee.set(a.employeeId, (tipByEmployee.get(a.employeeId) ?? 0) + a.amount);
    }
  }

  return employees.map((e) => {
    const days = attendance.filter((a) => a.employeeId === e.id);
    const daysWorked = new Set(days.map((a) => dateKey(a.businessDate))).size;
    const hours = days.reduce((sum, a) => {
      const end = a.clockOut ?? a.clockIn;
      return sum + Math.max(0, (end.getTime() - a.clockIn.getTime()) / 3_600_000 - a.breakMinutes / 60);
    }, 0);
    const rate = Number(e.payRate ?? 0);
    // MONTHLY staff are prorated over 26 working days so a partial period
    // produces a sensible sheet rather than a full month's salary.
    const base = e.payType === "HOURLY" ? rate * hours : e.payType === "DAILY" ? rate * daysWorked : (rate * daysWorked) / 26;
    const advance = advances.filter((x) => x.employeeId === e.id).reduce((s, x) => s + Number(x.amount), 0);
    const deduction = deductions.filter((x) => x.employeeId === e.id).reduce((s, x) => s + Number(x.amount), 0);
    const mealCost = meals.filter((x) => x.employeeId === e.id).reduce((s, x) => s + Number(x.cost ?? 0), 0);
    const tip = tipByEmployee.get(e.id) ?? 0;
    return {
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName ?? ""}`.trim(),
      position: e.position,
      payType: e.payType,
      rate,
      daysWorked,
      hours: Math.round(hours * 100) / 100,
      lateMinutes: days.reduce((s, a) => s + a.lateMinutes, 0),
      base: Math.round(base * 100) / 100,
      advance: Math.round(advance * 100) / 100,
      deduction: Math.round(deduction * 100) / 100,
      mealCost: Math.round(mealCost * 100) / 100,
      tip: Math.round(tip * 100) / 100,
      totalOwed: Math.round((base + tip - advance - deduction - mealCost) * 100) / 100,
    };
  });
}

export async function copyRosterWeek(restaurantId: string) {
  // Roster shifts recur by weekday, so "copy last week" adds any missing
  // weekday pattern rather than duplicating an existing one.
  const source = await prisma.rosterShift.findMany({ where: { restaurantId } });
  let copied = 0;
  for (const row of source) {
    const exists = await prisma.rosterShift.findUnique({
      where: {
        restaurantId_employeeId_dayOfWeek_shift: {
          restaurantId,
          employeeId: row.employeeId,
          dayOfWeek: row.dayOfWeek,
          shift: row.shift,
        },
      },
    });
    if (exists) continue;
    await prisma.rosterShift.create({
      data: {
        restaurantId,
        employeeId: row.employeeId,
        dayOfWeek: row.dayOfWeek,
        shift: row.shift,
        position: row.position,
      },
    });
    copied += 1;
  }
  return { copied };
}

import type { Role } from "@prisma/client";
import { prisma } from "./prisma.js";

/**
 * Capability matrix (PRD Appendix B). The API is the source of truth:
 * every route declares the capability it needs and the middleware enforces it.
 */
export type Capability =
  | "pos.use"
  | "order.discount.small" // â‰¤ threshold, e.g. 10%
  | "order.discount.large" // > threshold, requires manager approval
  | "order.void"
  | "order.refund"
  | "order.transfer"
  | "order.reprint"
  | "approve.override" // approve a discount/void/refund beyond the actor's limit
  | "table.manage"
  | "kds.view"
  | "kds.update"
  | "shift.open"
  | "shift.close"
  | "shift.manage"
  | "report.view"
  | "report.z"
  | "report.profit"
  | "report.pay"
  | "menu.manage"
  | "inventory.view"
  | "inventory.manage"
  | "expense.manage"
  | "cash.drop"
  | "cash.paidout"
  | "user.view"
  | "user.create"
  | "user.edit"
  | "user.reset_credential"
  | "user.deactivate"
  | "user.assign_role"
  | "staff.manage"
  | "employee.view"
  | "employee.manage"
  | "attendance.edit"
  | "payroll.view"
  | "settings.manage"
  | "audit.view"
  | "audit.view.own"
  | "backup.manage"
  | "hardware.manage";

const ALL: Capability[] = [
  "pos.use", "order.discount.small", "order.discount.large", "order.void", "order.refund",
  "order.transfer", "order.reprint", "approve.override", "table.manage", "kds.view", "kds.update",
  "shift.open", "shift.close", "shift.manage", "report.view", "report.z", "report.profit", "report.pay",
  "menu.manage", "inventory.view", "inventory.manage", "expense.manage", "cash.drop", "cash.paidout",
  "user.view", "user.create", "user.edit", "user.reset_credential", "user.deactivate", "user.assign_role",
  "staff.manage", "employee.view", "employee.manage", "attendance.edit", "payroll.view",
  "settings.manage", "audit.view", "audit.view.own", "backup.manage", "hardware.manage",
];



export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  OWNER: [...ALL],
  // Admin: back-office + accounts, but no profit/pay figures, no approvals, no employee pay.
  ADMIN: ALL.filter(
    (c) => !["report.profit", "report.pay", "approve.override", "employee.manage", "payroll.view", "attendance.edit"].includes(c),
  ),
  // Manager: floor lead. Approves overrides up to a limit; sees schedule/attendance.
  MANAGER: Array.from(new Set(ALL.filter(
    (c) =>
      ![
        "staff.manage", "settings.manage", "audit.view", "backup.manage", "hardware.manage",
        "report.profit", "report.pay", "employee.manage", "payroll.view",
        "user.create", "user.assign_role",
      ].includes(c),
  ))),
  CASHIER: [
    "pos.use", "order.discount.small", "kds.view", "shift.open", "shift.close",
    "report.view", "inventory.view", "cash.drop", "cash.paidout", "order.reprint", "audit.view.own",
  ],
  WAITER: ["pos.use", "order.discount.small", "table.manage", "kds.view", "report.view", "inventory.view", "order.transfer", "order.reprint"],
  KITCHEN: ["kds.view", "kds.update", "inventory.view"],
};
// (capability matrix above is the source of truth)

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

export async function resolveCapabilities(userId: string, role: Role): Promise<Capability[]> {
  const base = ROLE_CAPABILITIES[role] ?? [];
  const overrides = await prisma.userCapabilityOverride.findMany({
    where: { userId, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
  }).catch(() => [] as { capability: string; granted: boolean }[]);
  const set = new Set<Capability>(base);
  for (const o of overrides) {
    if (o.granted) set.add(o.capability as Capability);
    else set.delete(o.capability as Capability);
  }
  return [...set];
}

/** Roles allowed to open the Admin workspace. */
export const ADMIN_ROLES: Role[] = ["OWNER", "ADMIN"];
/** Roles that may approve overrides (derived from the capability, never a name list). */
export const MANAGER_ROLES: Role[] = (Object.keys(ROLE_CAPABILITIES) as Role[]).filter((r) =>
  ROLE_CAPABILITIES[r].includes("approve.override"),
);

export const DISCOUNT_THRESHOLD = 0.1; // cashier may apply up to 10% alone

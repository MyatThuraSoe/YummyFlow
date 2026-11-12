import type { Role } from "@prisma/client";

/**
 * Capability matrix (PRD Appendix B). The API is the source of truth:
 * every route declares the capability it needs and the middleware enforces it.
 */
export type Capability =
  | "pos.use"
  | "order.discount.small" // ≤ threshold, e.g. 10%
  | "order.discount.large" // > threshold, requires manager approval
  | "order.void"
  | "order.refund"
  | "approve.override" // approve a discount/void/refund beyond the actor's limit
  | "table.manage"
  | "kds.view"
  | "kds.update"
  | "shift.open"
  | "shift.close"
  | "shift.manage"
  | "report.view"
  | "report.z"
  | "menu.manage"
  | "inventory.view"
  | "inventory.manage"
  | "expense.manage"
  | "staff.manage"
  | "settings.manage"
  | "audit.view"
  | "backup.manage"
  | "hardware.manage";

const ALL: Capability[] = [
  "pos.use", "order.discount.small", "order.discount.large", "order.void", "order.refund",
  "approve.override", "table.manage", "kds.view", "kds.update", "shift.open", "shift.close", "shift.manage",
  "report.view", "report.z", "menu.manage", "inventory.view", "inventory.manage",
  "expense.manage", "staff.manage", "settings.manage", "audit.view", "backup.manage",
  "hardware.manage",
];

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  OWNER: [...ALL],
  // Admin: full back-office access plus floor operations.
  ADMIN: [...ALL],
  // Manager: everything except the last-admin/platform-level capabilities.
  MANAGER: ALL.filter(
    (c) => !["staff.manage", "settings.manage", "audit.view", "backup.manage", "hardware.manage"].includes(c),
  ),
  CASHIER: [
    "pos.use", "order.discount.small", "kds.view", "shift.open", "shift.close",
    "report.view", "inventory.view",
  ],
  WAITER: ["pos.use", "order.discount.small", "table.manage", "kds.view", "report.view", "inventory.view"],
  KITCHEN: ["kds.view", "kds.update", "inventory.view"],
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

/** Roles allowed to open the Admin workspace. */
export const ADMIN_ROLES: Role[] = ["OWNER", "ADMIN"];
/** Roles that may approve overrides (derived from the capability, never a name list). */
export const MANAGER_ROLES: Role[] = (Object.keys(ROLE_CAPABILITIES) as Role[]).filter((r) =>
  ROLE_CAPABILITIES[r].includes("approve.override"),
);

export const DISCOUNT_THRESHOLD = 0.1; // cashier may apply up to 10% alone

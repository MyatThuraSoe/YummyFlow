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
  "table.manage", "kds.view", "kds.update", "shift.open", "shift.close", "shift.manage",
  "report.view", "report.z", "menu.manage", "inventory.view", "inventory.manage",
  "expense.manage", "staff.manage", "settings.manage", "audit.view", "backup.manage",
  "hardware.manage",
];

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  OWNER: [...ALL],
  ADMIN: ALL.filter((c) => c !== "pos.use" || true), // Admin: all except physical cashier duties
  CASHIER: [
    "pos.use", "order.discount.small", "shift.open", "shift.close", "report.view",
    "inventory.view", "kds.view",
  ],
  WAITER: ["pos.use", "order.discount.small", "table.manage", "kds.view", "inventory.view"],
  KITCHEN: ["kds.view", "kds.update", "inventory.view"],
};

// Admin can do everything except own a cash shift (owner/cashier handle drawers).
ROLE_CAPABILITIES.ADMIN = ALL.filter((c) => c !== "shift.open" && c !== "shift.close");

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

/** Roles allowed to open the Admin workspace. */
export const ADMIN_ROLES: Role[] = ["OWNER", "ADMIN"];
/** Roles allowed to approve overrides (voids/refunds/large discounts). */
export const MANAGER_ROLES: Role[] = ["OWNER", "ADMIN"];

export const DISCOUNT_THRESHOLD = 0.1; // cashier may apply up to 10% alone

import crypto from "node:crypto";
import { env } from "./env.js";
import { getMachineId } from "./machine.js";
import { ApiError } from "./errors.js";
import { prisma } from "./prisma.js";

/**
 * Plan limits (PRD §2.1 / §9). This build ships the BASIC edition, so the
 * defaults are Max 2 terminals / 15 tables / 50 menu items / 1 branch.
 * A signed license key can raise them to PROFESSIONAL or ENTERPRISE.
 */

export type Edition = "BASIC" | "PROFESSIONAL" | "ENTERPRISE";

export interface PlanLimits {
  edition: Edition;
  maxTerminals: number;
  maxTables: number;
  maxMenuItems: number;
  maxBranches: number;
}

const EDITION_LIMITS: Record<Edition, PlanLimits> = {
  BASIC: { edition: "BASIC", maxTerminals: 2, maxTables: 15, maxMenuItems: 50, maxBranches: 1 },
  PROFESSIONAL: { edition: "PROFESSIONAL", maxTerminals: 5, maxTables: 50, maxMenuItems: 200, maxBranches: 1 },
  ENTERPRISE: { edition: "ENTERPRISE", maxTerminals: Number.MAX_SAFE_INTEGER, maxTables: Number.MAX_SAFE_INTEGER, maxMenuItems: Number.MAX_SAFE_INTEGER, maxBranches: Number.MAX_SAFE_INTEGER },
};

const BASIC_FEATURES = ["pos", "kds", "inventory", "reports", "reservations", "api_access"];
const ALL_FEATURES = [
  "pos", "kds", "reservations", "inventory", "reports", "loyalty", "qr_ordering",
  "multi_language", "customer_display", "multi_branch", "accounting", "api_access", "cloud_sync",
];

export interface MegaDineLicense {
  restaurantName: string;
  edition: Edition;
  maxTerminals: number;
  maxTables: number;
  maxMenuItems: number;
  features: string[];
  issuedAt: string;
  expiresAt: string;
  hardwareFingerprint: string;
  signature?: string;
}

/** Accept the public key as a PEM string or a single-line base64 SPKI DER. */
function publicKeyFromEnv(): crypto.KeyObject | null {
  const v = env.MEGACODE_LICENSE_PUBLIC_KEY.trim();
  if (!v) return null;
  if (v.includes("BEGIN")) return crypto.createPublicKey(v);
  return crypto.createPublicKey({ key: Buffer.from(v, "base64"), format: "der", type: "spki" });
}

/** Decode (and, if a public key is configured, verify) the license key. */
export function decodeLicense(licenseKey: string): MegaDineLicense {
  const decoded = JSON.parse(Buffer.from(licenseKey, "base64").toString("utf-8")) as MegaDineLicense & { signature?: string };
  const { signature, ...payload } = decoded;
  if (!signature) throw new Error("LICENSE_INVALID");
  const publicKey = publicKeyFromEnv();
  if (publicKey) {
    const ok = crypto.verify(
      "RSA-SHA256",
      Buffer.from(JSON.stringify(payload)),
      publicKey,
      Buffer.from(signature, "base64"),
    );
    if (!ok) throw new Error("LICENSE_INVALID");
  }
  if (decoded.expiresAt && new Date(decoded.expiresAt) < new Date()) throw new Error("LICENSE_EXPIRED");
  if (!EDITION_LIMITS[decoded.edition]) throw new Error("LICENSE_INVALID");
  // Hardware binding: the key only unlocks the machine it was issued for.
  if (decoded.hardwareFingerprint && decoded.hardwareFingerprint !== getMachineId()) {
    throw new Error("LICENSE_MACHINE_MISMATCH");
  }
  return decoded;
}

/** Limits in force right now. Falls back to BASIC when no/invalid key. */
export function getLimits(): PlanLimits {
  if (env.LICENSE_KEY) {
    try {
      const lic = decodeLicense(env.LICENSE_KEY);
      return {
        edition: lic.edition,
        maxTerminals: lic.maxTerminals ?? EDITION_LIMITS[lic.edition].maxTerminals,
        maxTables: lic.maxTables ?? EDITION_LIMITS[lic.edition].maxTables,
        maxMenuItems: lic.maxMenuItems ?? EDITION_LIMITS[lic.edition].maxMenuItems,
        maxBranches: lic.edition === "ENTERPRISE" ? Number.MAX_SAFE_INTEGER : 1,
      };
    } catch {
      // invalid/expired key → drop to Basic rather than taking the restaurant down
    }
  }
  return EDITION_LIMITS.BASIC;
}

export function getFeatures(): string[] {
  return getLimits().edition === "BASIC" ? BASIC_FEATURES : ALL_FEATURES;
}

export type LimitKind = "terminals" | "tables" | "menuItems";

const KIND_LABEL: Record<LimitKind, string> = {
  terminals: "terminals",
  tables: "tables",
  menuItems: "menu items",
};

/**
 * Throws 409 when the restaurant already has `used` records of `kind` and the
 * active plan does not allow more.
 */
export function assertWithinLimit(kind: LimitKind, used: number): void {
  const limits = getLimits();
  const max = kind === "terminals" ? limits.maxTerminals : kind === "tables" ? limits.maxTables : limits.maxMenuItems;
  if (used >= max) {
    throw new ApiError(
      409,
      "PLAN_LIMIT",
      `Plan limit reached: your ${limits.edition} plan allows up to ${max} ${KIND_LABEL[kind]}. Upgrade the license key to add more.`,
      { kind, used, max, edition: limits.edition },
    );
  }
}

/** Current usage across the restaurant (for the license dashboard). */
export async function limitUsage(restaurantId: string): Promise<{ limits: PlanLimits; features: string[]; usage: Record<LimitKind, number> }> {
  const [terminals, tables, menuItems] = await Promise.all([
    prisma.terminal.count({ where: { restaurantId } }),
    prisma.restaurantTable.count({ where: { restaurantId, isActive: true } }),
    prisma.menuItem.count({ where: { category: { restaurantId } } }),
  ]);
  return { limits: getLimits(), features: getFeatures(), usage: { terminals, tables, menuItems } };
}

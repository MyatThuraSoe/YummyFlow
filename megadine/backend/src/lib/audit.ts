import { createHash } from "node:crypto";
import { prisma } from "./prisma.js";

export interface AuditInput {
  restaurantId: string;
  userId: string;
  orderId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvedBy?: string | null;
  terminalId?: string | null;
  ipAddress?: string | null;
}

/** Sentinel used as the "previous hash" of the first entry in a chain. */
const GENESIS = "megadine-audit-genesis";

/** Deterministic JSON: object keys sorted so re-reading a Json column matches. */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

interface HashFields {
  seq: number;
  prevHash: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  orderId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvedBy?: string | null;
  terminalId?: string | null;
  ipAddress?: string | null;
}

/** SHA-256 over the chain link and the canonical form of one entry. */
function entryHash(f: HashFields): string {
  const payload = {
    seq: f.seq,
    prev: f.prevHash,
    action: f.action,
    entityType: f.entityType,
    entityId: f.entityId,
    userId: f.userId,
    orderId: f.orderId ?? null,
    before: f.before ?? null,
    after: f.after ?? null,
    reason: f.reason ?? null,
    approvedBy: f.approvedBy ?? null,
    terminalId: f.terminalId ?? null,
    ipAddress: f.ipAddress ?? null,
  };
  // Round-trip through JSON exactly as Prisma/JSONB does on write, so a value
  // re-read from the column hashes identically to the original object.
  const canonical = JSON.parse(JSON.stringify(payload)) as unknown;
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

/**
 * Audit writes are serialised per restaurant so there is only ever one chain
 * head. The app runs as a single backend process; this in-process lock is
 * enough to keep concurrent requests from forking the chain.
 */
const chainQueues = new Map<string, Promise<unknown>>();
function withChainLock<T>(restaurantId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chainQueues.get(restaurantId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chainQueues.set(restaurantId, next);
  const release = () => {
    if (chainQueues.get(restaurantId) === next) chainQueues.delete(restaurantId);
  };
  next.then(release, release);
  return next;
}

/** Append-only audit trail (PRD §9). Never throws into the request path. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await withChainLock(input.restaurantId, async () => {
      const last = await prisma.auditLog.findFirst({
        where: { restaurantId: input.restaurantId, hash: { not: null } },
        orderBy: [{ seq: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { seq: true, hash: true },
      });
      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? GENESIS;
      const hash = entryHash({ seq, prevHash, ...input });
      await prisma.auditLog.create({
        data: {
          restaurantId: input.restaurantId,
          userId: input.userId,
          orderId: input.orderId ?? undefined,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          before: (input.before ?? undefined) as never,
          after: (input.after ?? undefined) as never,
          reason: input.reason ?? undefined,
          approvedBy: input.approvedBy ?? undefined,
          terminalId: input.terminalId ?? undefined,
          ipAddress: input.ipAddress ?? undefined,
          seq,
          prevHash,
          hash,
        },
      });
    });
  } catch (err) {
    console.error("[audit] failed to write entry", err);
  }
}

export interface AuditIntegrity {
  /** True when every chained entry still matches its stored hash and link. */
  intact: boolean;
  /** Number of chained entries checked (older, pre-chain rows are ignored). */
  count: number;
  /** Sequence number of the first entry that failed verification, if any. */
  firstBrokenSeq: number | null;
}

/**
 * Re-walk the hash chain for a restaurant. Detects edited fields (hash
 * mismatch), deleted/reordered rows (sequence gap) and relinked rows
 * (prevHash mismatch). Rows written before chaining was enabled have no hash
 * and are skipped.
 */
export async function verifyAuditChain(restaurantId: string): Promise<AuditIntegrity> {
  const rows = await prisma.auditLog.findMany({
    where: { restaurantId, hash: { not: null }, seq: { not: null } },
    orderBy: [{ seq: "asc" }],
    select: {
      seq: true,
      hash: true,
      prevHash: true,
      action: true,
      entityType: true,
      entityId: true,
      userId: true,
      orderId: true,
      before: true,
      after: true,
      reason: true,
      approvedBy: true,
      terminalId: true,
      ipAddress: true,
    },
  });

  let prevHash = GENESIS;
  let expectedSeq = 1;
  let firstBrokenSeq: number | null = null;
  for (const row of rows) {
    const computed = entryHash({
      seq: row.seq!,
      prevHash,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      userId: row.userId,
      orderId: row.orderId,
      before: row.before,
      after: row.after,
      reason: row.reason,
      approvedBy: row.approvedBy,
      terminalId: row.terminalId,
      ipAddress: row.ipAddress,
    });
    if (row.seq !== expectedSeq || row.prevHash !== prevHash || row.hash !== computed) {
      firstBrokenSeq = row.seq!;
      break;
    }
    prevHash = row.hash!;
    expectedSeq = row.seq! + 1;
  }

  return { intact: firstBrokenSeq === null, count: rows.length, firstBrokenSeq };
}

export function clientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0]?.trim() ?? "";
  return req.ip ?? "";
}

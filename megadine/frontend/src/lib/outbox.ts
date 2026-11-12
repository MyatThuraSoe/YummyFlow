import { api, ApiError } from "./api";

export type OrderItemInput = {
  menuItemId: string;
  quantity: number;
  variantId?: string | null;
  modifierOptionIds?: string[];
  notes?: string | null;
};

export interface CreateOrderBody {
  channel: string;
  tableId: string | null;
  shiftId: string | null;
  items: OrderItemInput[];
  orderDiscount?: number;
  notes?: string | null;
  pickupName?: string | null;
  idempotencyKey?: string;
}

export interface PaymentBody {
  shiftId: string | null;
  idempotencyKey: string;
  payments: { method: string; amount: number; cashReceived?: number; reference?: string | null }[];
}

export interface PendingOrder {
  localId: string;
  createdAt: number;
  label: string;
  /** Set when the entry appends to / pays an existing order instead of creating one. */
  orderId?: string | null;
  /** Optional items to append to the existing order before send/pay. */
  addItems?: OrderItemInput[] | null;
  create: CreateOrderBody | null;
  sendToKitchen: boolean;
  pay: PaymentBody | null;
  /** Number of replay attempts, kept so a stuck entry is visible on the device. */
  attempts?: number;
  lastAttemptAt?: number | null;
  lastError?: string | null;
  /** Stable ids: a retry reuses them so the server never repeats the work. */
  requestIds?: { items: string; send: string };
}

/** An entry the server permanently rejected (4xx) or that needs a human. */
export interface OutboxFailure {
  localId: string;
  label: string;
  message: string;
  status: number | null;
  failedAt: number;
  entry: PendingOrder;
}

const KEY = "md_outbox";
const FAILED_KEY = "md_outbox_failed";

function read(): PendingOrder[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as PendingOrder[];
  } catch {
    return [];
  }
}

function write(list: PendingOrder[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("md:outbox"));
}

function readFailed(): OutboxFailure[] {
  try {
    return JSON.parse(localStorage.getItem(FAILED_KEY) ?? "[]") as OutboxFailure[];
  } catch {
    return [];
  }
}

function writeFailed(list: OutboxFailure[]) {
  localStorage.setItem(FAILED_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("md:outbox"));
}

export function pendingOrders(): PendingOrder[] {
  return read();
}

export function pendingCount(): number {
  return read().length;
}

export function failedOrders(): OutboxFailure[] {
  return readFailed();
}

export function failedCount(): number {
  return readFailed().length;
}

export function dismissFailure(localId: string) {
  writeFailed(readFailed().filter((f) => f.localId !== localId));
}

/** Put a failed entry back in the queue for another replay attempt. */
export function retryFailure(localId: string) {
  const failure = readFailed().find((f) => f.localId === localId);
  if (!failure) return;
  writeFailed(readFailed().filter((f) => f.localId !== localId));
  write([...read(), { ...failure.entry, attempts: 0, lastError: null, lastAttemptAt: null }]);
}

/** Queue an order (optionally with kitchen-send / payment) while offline. */
export function enqueueOrder(order: Omit<PendingOrder, "localId" | "createdAt">): PendingOrder {
  const entry: PendingOrder = {
    ...order,
    localId: crypto.randomUUID(),
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    requestIds: { items: crypto.randomUUID(), send: crypto.randomUUID() },
  };
  write([...read(), entry]);
  return entry;
}

export function removePending(localId: string) {
  write(read().filter((p) => p.localId !== localId));
}

/**
 * Replay queued orders in order. Each entry either creates a fresh order
 * (idempotent via idempotencyKey/requestIds) or appends to an existing one,
 * then sends it to the kitchen and/or charges it.
 *
 * Network errors keep the entry queued with its last error. A 4xx means the
 * server will never accept it, so it moves to the visible failed list instead
 * of retrying forever or disappearing silently.
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number; pending: number }> {
  const list = read();
  const remaining: PendingOrder[] = [];
  const failures: OutboxFailure[] = [];
  let sent = 0;

  for (const entry of list) {
    try {
      let targetOrderId = entry.orderId ?? null;
      const requestIds = entry.requestIds ?? { items: crypto.randomUUID(), send: crypto.randomUUID() };
      if (targetOrderId) {
        if (entry.addItems && entry.addItems.length) {
          await api(`/orders/${targetOrderId}/items`, {
            method: "POST",
            body: { items: entry.addItems, requestId: requestIds.items },
          });
        }
      } else if (entry.create) {
        const created = await api<{ order: { id: string; orderNumber: number } }>("/orders", {
          method: "POST",
          body: { ...entry.create, idempotencyKey: entry.create.idempotencyKey ?? `outbox-${entry.localId}` },
        });
        targetOrderId = created.order.id;
      } else {
        continue;
      }
      if (entry.sendToKitchen) {
        await api(`/orders/${targetOrderId}/send-to-kitchen`, {
          method: "POST",
          body: { requestId: requestIds.send },
        });
      }
      if (entry.pay) {
        await api("/payments", {
          method: "POST",
          body: { orderId: targetOrderId, shiftId: entry.pay.shiftId, idempotencyKey: entry.pay.idempotencyKey, payments: entry.pay.payments },
        });
      }
      sent += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        failures.push({ localId: entry.localId, label: entry.label, message, status: e.status, failedAt: Date.now(), entry });
      } else {
        remaining.push({ ...entry, attempts: (entry.attempts ?? 0) + 1, lastAttemptAt: Date.now(), lastError: message });
      }
    }
  }

  write(remaining);
  if (failures.length) writeFailed([...readFailed(), ...failures]);
  return { sent, failed: failures.length, pending: remaining.length };
}

export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && /fetch|network|Failed to fetch/i.test(e.message));
}

/** True when the browser is offline or the last request failed with a network error. */
export function shouldQueue(e?: unknown): boolean {
  if (!navigator.onLine) return true;
  return e !== undefined && isNetworkError(e);
}

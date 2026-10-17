import { api, ApiError } from "./api";

export interface CreateOrderBody {
  channel: string;
  tableId: string | null;
  shiftId: string | null;
  items: { menuItemId: string; quantity: number; variantId?: string | null; modifierOptionIds?: string[]; notes?: string | null }[];
  orderDiscount?: number;
}

export interface PaymentBody {
  shiftId: string | null;
  idempotencyKey: string;
  payments: { method: string; amount: number; cashReceived?: number }[];
}

export interface PendingOrder {
  localId: string;
  createdAt: number;
  label: string;
  create: CreateOrderBody;
  sendToKitchen: boolean;
  pay: PaymentBody | null;
}

const KEY = "md_outbox";

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

export function pendingOrders(): PendingOrder[] {
  return read();
}

export function pendingCount(): number {
  return read().length;
}

/** Queue an order (optionally with kitchen-send / payment) while offline. */
export function enqueueOrder(order: Omit<PendingOrder, "localId" | "createdAt">): PendingOrder {
  const entry: PendingOrder = { ...order, localId: crypto.randomUUID(), createdAt: Date.now() };
  write([...read(), entry]);
  return entry;
}

export function removePending(localId: string) {
  write(read().filter((p) => p.localId !== localId));
}

/**
 * Replay queued orders in order. Each entry creates the order first (idempotent
 * via idempotencyKey), then sends it to the kitchen and/or charges it.
 * Returns { sent, failed }.
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  const list = read();
  let sent = 0;
  let failed = 0;
  for (const entry of list) {
    try {
      const createBody = {
        ...entry.create,
        idempotencyKey: `outbox-${entry.localId}`,
      };
      const created = await api<{ order: { id: string; orderNumber: number } }>("/orders", { method: "POST", body: createBody });
      if (entry.sendToKitchen) {
        await api(`/orders/${created.order.id}/send-to-kitchen`, { method: "POST" });
      }
      if (entry.pay) {
        await api("/payments", {
          method: "POST",
          body: { orderId: created.order.id, shiftId: entry.pay.shiftId, idempotencyKey: entry.pay.idempotencyKey, payments: entry.pay.payments },
        });
      }
      removePending(entry.localId);
      sent += 1;
    } catch (e) {
      // Keep network failures queued; drop permanent validation errors.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        removePending(entry.localId);
      }
      failed += 1;
    }
  }
  return { sent, failed };
}

export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && /fetch|network|Failed to fetch/i.test(e.message));
}

/** True when the browser is offline or the last request failed with a network error. */
export function shouldQueue(e?: unknown): boolean {
  if (!navigator.onLine) return true;
  return e !== undefined && isNetworkError(e);
}

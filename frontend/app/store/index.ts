import type { itemsProps, OrderItem, TablesProps } from "@/type";
import { proxy, subscribe } from "valtio";

interface OrderState {
  items: OrderItem[];
  total: number;
  type: "dine-in" | "take-away";
  table?: TablesProps | null;
}

const calculateTotal = (items: OrderItem[]) => {
  return items.reduce(
    (acc, item) => acc + (item.price || 0) * item.quantity,
    0,
  );
};

let lineSeq = 0;

/** Unique id for a cart line, with a fallback for hosts without `crypto`. */
const newLineId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `line-${Date.now().toString(36)}-${++lineSeq}`;

/**
 * Backfill carts saved by an earlier version of the app.
 *
 * The cart is persisted to localStorage and survives a deploy, so a cart
 * written before notes existed arrives with no `lineId` at all. Every line
 * would then share `lineId: undefined`, and changing the quantity of one dish
 * would hit whichever line happened to be found first.
 */
const normaliseItems = (raw: unknown): OrderItem[] => {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const line = item as Partial<OrderItem>;
      const quantity = Number(line.quantity);
      return {
        ...line,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        lineId:
          typeof line.lineId === "string" && line.lineId
            ? line.lineId
            : newLineId(),
        notes: typeof line.notes === "string" ? line.notes : "",
      } as OrderItem;
    });
};

const createOrderStore = (storageKey: string) => {
  const getInitialState = (): OrderState => {
    // SSR satety
    if (typeof window === "undefined")
      return { items: [], total: 0, type: "dine-in", table: null };

    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return { items: [], total: 0, type: "dine-in", table: null };

      const parsed = JSON.parse(saved) as OrderState;
      // Ensure items is always an array to prevent .map crashes
      const items = normaliseItems(parsed.items);
      return {
        ...parsed,
        items,
        // Recompute rather than trust the stored figure, which may predate the
        // items it is supposed to describe.
        total: calculateTotal(items),
        type: parsed.type || "dine-in",
        table: parsed.table || null,
      };
    } catch (error) {
      return { items: [], total: 0, type: "dine-in", table: null };
    }
  };

  const state = proxy<OrderState>(getInitialState());

  const actions = {
    addItem: (product: itemsProps) => {
      // Merge only into a plain line for the same dish. A line that already
      // carries a note is left alone, so "no onions" and a normal portion
      // become two tickets instead of one the kitchen has to guess at.
      const existing = state.items.find(
        (item) => item.id === product.id && !item.notes,
      );

      if (existing) {
        existing.quantity += 1;
      } else {
        state.items.push({
          ...product,
          quantity: 1,
          lineId: newLineId(),
          notes: "",
        });
      }
      state.total = calculateTotal(state.items);
    },
    updateQuantity: (lineId: string, amount: number) => {
      const item = state.items.find((i) => i.lineId === lineId);
      if (!item) return;

      item.quantity += amount;
      if (item.quantity <= 0) {
        state.items = state.items.filter((i) => i.lineId !== lineId);
      }
      state.total = calculateTotal(state.items);
    },
    removeItem: (lineId: string) => {
      state.items = state.items.filter((i) => i.lineId !== lineId);
      state.total = calculateTotal(state.items);
    },
    /** Attach or clear a kitchen instruction for one line. */
    setItemNotes: (lineId: string, notes: string) => {
      const item = state.items.find((i) => i.lineId === lineId);
      if (item) item.notes = notes;
    },
    setType: (type: "dine-in" | "take-away") => {
      state.type = type;
    },
    setTable: (table: TablesProps | null) => {
      state.table = table;
    },
    reset: () => {
      state.items = [];
      state.total = 0;
      state.type = "dine-in";
      state.table = null;
    },
  };
  subscribe(state, () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(storageKey, JSON.stringify(state));
    }
  });

  return { state, actions };
};

export const homeCart = createOrderStore("homeCart");
export const posCart = createOrderStore("posCart");

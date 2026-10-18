import { create } from "zustand";

export interface CartModifier {
  id: string;
  name: string;
  price: number; // cents
}

export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number; // cents (incl. variant, excl. modifiers)
  variantId?: string | null;
  variantName?: string | null;
  modifiers: CartModifier[];
  quantity: number;
  notes?: string | null;
}

export type Channel = "DINE_IN" | "TAKEAWAY" | "PARCEL";

interface CartState {
  channel: Channel;
  tableId: string | null;
  tableLabel: string | null;
  orderId: string | null;
  orderNumber: number | null;
  lines: CartLine[];
  orderDiscount: number; // cents
  setChannel: (c: Channel) => void;
  setTable: (id: string | null, label: string | null) => void;
  addLine: (line: Omit<CartLine, "key">) => void;
  incQty: (key: string) => void;
  decQty: (key: string) => void;
  removeLine: (key: string) => void;
  setOrderDiscount: (cents: number) => void;
  setOrder: (orderId: string, orderNumber: number) => void;
  clearLines: () => void;
  loadFromServer: (payload: {
    channel: Channel;
    tableId: string | null;
    tableLabel: string | null;
    orderId: string;
    orderNumber: number;
    orderDiscount: number;
    lines: CartLine[];
  }) => void;
  reset: () => void;
  lineTotal: (l: CartLine) => number;
  lineTotals: () => number[];
}

const lineKey = (l: Omit<CartLine, "key">) =>
  `${l.menuItemId}:${l.variantId ?? ""}:${l.modifiers.map((m) => m.id).sort().join(",")}:${l.notes ?? ""}`;

export const useCart = create<CartState>((set, get) => ({
  channel: "DINE_IN",
  tableId: null,
  tableLabel: null,
  orderId: null,
  orderNumber: null,
  lines: [],
  orderDiscount: 0,
  setChannel: (channel) => set({ channel }),
  setTable: (tableId, tableLabel) => set({ tableId, tableLabel }),
  addLine: (line) => {
    const key = lineKey(line);
    const existing = get().lines.find((l) => l.key === key);
    if (existing) {
      set({ lines: get().lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + line.quantity } : l)) });
    } else {
      set({ lines: [...get().lines, { ...line, key }] });
    }
  },
  incQty: (key) => set({ lines: get().lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l)) }),
  decQty: (key) =>
    set({
      lines: get()
        .lines.map((l) => (l.key === key ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0),
    }),
  removeLine: (key) => set({ lines: get().lines.filter((l) => l.key !== key) }),
  setOrderDiscount: (cents) => set({ orderDiscount: cents }),
  setOrder: (orderId, orderNumber) => set({ orderId, orderNumber }),
  clearLines: () => set({ lines: [], orderDiscount: 0 }),
  loadFromServer: (payload) =>
    set({
      channel: payload.channel,
      tableId: payload.tableId,
      tableLabel: payload.tableLabel,
      orderId: payload.orderId,
      orderNumber: payload.orderNumber,
      orderDiscount: payload.orderDiscount,
      lines: payload.lines,
    }),
  reset: () => set({ lines: [], orderDiscount: 0, orderId: null, orderNumber: null, tableId: null, tableLabel: null }),
  lineTotal: (l) => {
    const mods = l.modifiers.reduce((s, m) => s + m.price, 0);
    return (l.unitPrice + mods) * l.quantity;
  },
  lineTotals: () => get().lines.map((l) => get().lineTotal(l)),
}));

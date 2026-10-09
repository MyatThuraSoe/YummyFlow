import type {
  Order,
  OrderStatus,
  OrderType,
  PaginatedResponseProps,
  PaymentMethod,
  PaymentStatus,
  Reservation,
  TableStatus,
} from "@/type";

export const API_URL = `http://localhost:5000/api`;

/**
 * An error thrown by `customFetch`, carrying the HTTP status and any
 * retry hint the server sent.
 *
 * The status used to be discarded, so every failure reached the UI as a bare
 * `Error` with only a string. That made it impossible for a component to tell a
 * lost booking race (409, try another time) from a rate limit (429, wait) from
 * an expired session (401, sign in again) — all three rendered as the same red
 * toast. Carrying `status` is what lets each screen respond appropriately.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    status: number,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Reusable fetch wrapper to handle JSON, errors, and BetterAuth cookies
export async function customFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include", // Crucial for BetterAuth!
  });

  if (!response.ok) {
    // Attempt to parse the backend error message
    const errorData = await response.json().catch(() => ({}));

    // The rate limiter advertises how long to wait on both the body and the
    // `Retry-After` header. Prefer the body's explicit value, fall back to the
    // standard header.
    const headerHint = Number(response.headers.get("Retry-After"));
    const retryAfterSeconds =
      typeof errorData.retryAfterSeconds === "number"
        ? errorData.retryAfterSeconds
        : Number.isFinite(headerHint) && headerHint > 0
          ? headerHint
          : undefined;

    throw new ApiError(
      errorData.error ||
        errorData.message ||
        `HTTP error! status: ${response.status}`,
      response.status,
      retryAfterSeconds,
    );
  }

  return response.json();
}

// ==========================================
// CATEGORIES
// ==========================================

export const createCategory = ({ name }: { name: string }) => {
  return customFetch(`/category/create`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
};

export const updateCategory = ({ id, name }: { id: string; name: string }) => {
  return customFetch(`/category/update/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
};

export const deleteCategory = ({ id }: { id: string }) => {
  return customFetch(`/category/delete/${id}`, {
    method: "DELETE",
  });
};

// ==========================================
// MENU ITEMS
// ==========================================

export const createMenuItem = ({
  data,
}: {
  data: {
    name: string;
    description?: any[] | undefined;
    price: number;
    categoryId: string;
    isAvailable: boolean;
    image?: string;
    discount?: number | undefined;
  };
}) => {
  return customFetch(`/menu/create`, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const updateMenuItem = ({
  id,
  data,
}: {
  id: string;
  data: {
    name: string;
    description?: any[] | undefined;
    price: number;
    categoryId: string;
    isAvailable: boolean;
    image?: string;
    discount?: number | undefined;
  };
}) => {
  return customFetch(`/menu/update/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
};

// Fetch reservations (Pass userId for the Profile page, leave empty for Admin page)
export const fetchReservations = ({
  userId,
  page,
}: {
  userId?: string;
  page: number;
}) => {
  const params = new URLSearchParams();
  if (userId) params.append("userId", userId);
  params.append("page", page.toString());

  return customFetch<PaginatedResponseProps<Reservation>>(
    `/reservations?${params.toString()}`,
    {
      method: "GET",
    },
  );
};

// Update reservation status (Admin only)
export const updateResStatus = ({
  id,
  status,
}: {
  id: string;
  status: string;
}) => {
  return customFetch(`/reservations/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
};

// ==========================================
// TABLES
// ==========================================
export const updateTableStatus = (args: {
  id: string;
  status: TableStatus;
}) => {
  return customFetch(`/tables/${args.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: args.status }),
  });
};

export const updateTable = (args: {
  id: string;
  name: string;
  seats: number;
  section: "Main Dining Room" | "Outdoor" | "Terrace";
  shape: "square" | "circle" | "rectangle";
}) => {
  return customFetch(`/tables/${args.id}/update`, {
    method: "PATCH",
    body: JSON.stringify(args),
  });
};

export const createTable = (args: {
  name: string;
  seats: number;
  section: string;
  shape: string;
}) => {
  return customFetch(`/tables/create`, {
    method: "POST",
    body: JSON.stringify(args),
  });
};

// ==========================================
// ORDERS
// ==========================================
export const submitOrder = (data: {
  items: Array<{ id: string; quantity: number; notes?: string }>;
  orderType: string;
  tableId?: string | null;
}) => {
  // we don't have orders yet
  return customFetch(`/orders`, {
    method: "POST",
    body: JSON.stringify(data),
  });
};

export const deleteTable = ({ id }: { id: string }) => {
  return customFetch(`/tables/${id}/delete`, {
    method: "DELETE",
  });
};

export const getOrders = ({
  args,
}: {
  args: {
    userId?: string;
    page: number;
  };
}) => {
  // 1. Build the query string
  const params = new URLSearchParams();

  if (args.userId) {
    params.append("userId", args.userId);
  }
  params.append("page", args.page.toString());

  // 2. Attach the query string to the URL and remove the 'body'
  return customFetch<PaginatedResponseProps<Order>>(
    `/orders?${params.toString()}`,
    {
      method: "GET",
    },
  );
};

export const updateOrderDetails = (args: {
  id: string;
  field: string;
  value: string;
}) => {
  return customFetch(`/orders/${args.id}`, {
    method: "PATCH",
    body: JSON.stringify({ field: args.field, value: args.value }),
  });
};

// ==========================================
// ACTIVE ORDERS (Kitchen Display / POS board)
// ==========================================

/** Statuses that still need somebody to act on them. */
export type OpenOrderStatus = Extract<
  OrderStatus,
  "PENDING" | "PREPARING" | "READY"
>;

/**
 * A kitchen ticket. Deliberately smaller than `Order` — no prices, no customer
 * identity, no payment state — because this is the most frequently refreshed
 * payload in the app.
 */
export type OrderTicket = {
  id: string;
  orderType: OrderType;
  status: OpenOrderStatus;
  createdAt: string;
  table: { id: string; name: string } | null;
  items: {
    id: string;
    quantity: number;
    notes: string | null;
    menuItem: { id: string; name: string };
  }[];
};

/**
 * Every order currently in flight, oldest first.
 *
 * `serverTime` comes from the API so elapsed-time badges are measured against
 * one clock rather than each tablet's, which are rarely in sync.
 */
export const getActiveOrders = () =>
  customFetch<{ data: OrderTicket[]; serverTime: string }>("/orders/active");

/**
 * The till's view of the open orders: same tickets plus the money.
 *
 * The kitchen shape deliberately omits prices, so the POS asks for the richer
 * projection rather than the server sending one payload nobody fully needs.
 */
export type PosActiveOrder = OrderTicket & {
  totalAmount: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
};

export const getPosActiveOrders = () =>
  customFetch<{ data: PosActiveOrder[]; serverTime: string }>(
    "/orders/active?view=pos",
  );

/**
 * Status-only transition — the route the kitchen display and the floor use.
 *
 * Separate from `updateOrderDetails` on purpose: this one cannot touch payment
 * or order type, so it is safe to hand to KITCHEN and STAFF.
 */
export const updateOrderStatus = (args: {
  id: string;
  status: OrderStatus;
}) => {
  return customFetch(`/orders/${args.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: args.status }),
  });
};

/**
 * Payment-only update — the route the till uses.
 *
 * Safe to hand to STAFF, unlike `updateOrderDetails`, because it cannot touch
 * order type or status.
 */
export const updateOrderPayment = (args: {
  id: string;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
}) => {
  return customFetch(`/orders/${args.id}/payment`, {
    method: "PATCH",
    body: JSON.stringify({
      paymentStatus: args.paymentStatus,
      paymentMethod: args.paymentMethod,
    }),
  });
};

/** The next step in the kitchen flow, or null when the order is done. */
export const NEXT_OPEN_STATUS: Record<OrderStatus, OrderStatus | null> = {
  PENDING: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
  SERVED: null,
  CANCELLED: null,
};

/**
 * One order with its per-line prices, for a receipt reprint.
 *
 * The kitchen and POS boards deliberately omit line prices so the payload that
 * refreshes every few seconds stays small, which means neither can render a
 * full chit from what it already holds. A reprint fetches this for the single
 * order on demand instead.
 */
export type OrderReceipt = {
  id: string;
  orderType: OrderType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  totalAmount: number;
  createdAt: string;
  table: { name: string } | null;
  items: {
    quantity: number;
    price: number;
    notes: string | null;
    menuItem: { name: string };
  }[];
};

export const getOrderReceipt = (id: string) =>
  customFetch<OrderReceipt>(`/orders/${id}`);

// ==========================================
// DAY CLOSE / Z REPORT
// ==========================================

export type DayCloseReport = {
  businessDate: string;
  window: { start: string; end: string };
  revenue: {
    gross: number;
    collected: number;
    outstanding: number;
    voided: number;
  };
  orders: {
    total: number;
    paid: number;
    open: number;
    cancelled: number;
    averageTicket: number;
    byType: { type: OrderType; count: number; revenue: number }[];
    byStatus: { status: OrderStatus; count: number }[];
  };
  payments: { method: PaymentMethod; count: number; amount: number }[];
  hourly: { hour: number; orders: number; revenue: number }[];
  items: { name: string; quantity: number; revenue: number }[];
  voids: {
    id: string;
    orderType: OrderType;
    totalAmount: number;
    createdAt: string;
    tableName: string | null;
  }[];
  tables: {
    total: number;
    seats: number;
    available: number;
    occupied: number;
    reserved: number;
    cleaning: number;
    occupancyPct: number;
  };
  reservations: {
    total: number;
    guests: number;
    pending: number;
    confirmed: number;
    cancelled: number;
    completed: number;
  };
  /** Reasons the day is not closed yet; empty means it is clear. */
  blockers: string[];
  closed: boolean;
};

/** Day-close totals. Omit `date` for today. */
export const getDayClose = (date?: string) => {
  const params = new URLSearchParams();
  if (date) params.append("date", date);
  const qs = params.toString();

  return customFetch<{ data: DayCloseReport; serverTime: string }>(
    `/reports/day-close${qs ? `?${qs}` : ""}`,
  );
};

// ==========================================
// reservations
// ==========================================
export const createReservation = (args: {
  customerName: string;
  date: string;
  guests: number;
  tableId: string;
  /** PRO: optional — lets guest bookings receive the confirmation email. */
  email?: string;
}) => {
  return customFetch(`/reservations/create`, {
    method: "POST",
    body: JSON.stringify(args),
  });
};

// ==========================================
// AI BRIEFINGS (PRO)
// ==========================================

export type BriefingHighlight = {
  label: string;
  value: string;
  delta: number | null;
};

export type BriefingAction = {
  title: string;
  detail: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
};

export type BriefingPayload = {
  kind: "EXECUTIVE" | "FORECAST";
  generatedBy: "gemini" | "heuristic";
  highlights?: BriefingHighlight[];
  insights: string[];
  risks: string[];
  actions: BriefingAction[];
  metrics?: BriefingMetrics;
  forecast?: BriefingForecast;
};

export type BriefingMetrics = {
  periodStart: string;
  periodEnd: string;
  windowDays: number;
  revenue: { current: number; previous: number; trend: number };
  orders: { current: number; previous: number; trend: number };
  aov: { current: number; previous: number; trend: number };
  orderMix: { type: string; count: number; revenue: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
  categoryRevenue: { name: string; revenue: number }[];
  peakHours: { hour: number; orders: number }[];
  reservations: {
    total: number;
    pending: number;
    confirmed: number;
    cancelled: number;
    guests: number;
  };
  tables: {
    total: number;
    available: number;
    occupied: number;
    reserved: number;
    cleaning: number;
    seats: number;
    occupancyPct: number;
  };
  menuHealth: {
    total: number;
    outOfStock: string[];
    avgRating: number | null;
    lowRated: { name: string; rating: number; reviews: number }[];
  };
  dailySeries: { date: string; revenue: number; orders: number }[];
};

export type BriefingForecastPoint = {
  date: string;
  weekday: string;
  predictedRevenue: number;
  predictedOrders: number;
  confidence: number;
  lower: number;
  upper: number;
  basis: string;
};

export type BriefingForecast = {
  points: BriefingForecastPoint[];
  totalPredicted: number;
  busiest: BriefingForecastPoint;
  quietest: BriefingForecastPoint;
  dampedTrend: number;
};

export type Briefing = {
  id: string;
  kind: "EXECUTIVE" | "FORECAST";
  headline: string;
  summary: string;
  payload: BriefingPayload;
  model: string | null;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
};

/** Cached latest briefing of each kind — never triggers AI generation. */
export const getLatestBriefings = () =>
  customFetch<{ data: { executive: Briefing | null; forecast: Briefing | null } }>(
    "/briefings/latest",
  );

/** Live metrics + deterministic forecast. No AI, no persistence — renders fast. */
export const getBriefingMetrics = () =>
  customFetch<{ data: { metrics: BriefingMetrics; forecast: BriefingForecast } }>(
    "/briefings/metrics",
  );

/** Generate a fresh briefing (calls Gemini, falls back to heuristics). */
export const generateBriefing = (kind: "EXECUTIVE" | "FORECAST") =>
  customFetch<{ data: Briefing }>("/briefings/generate", {
    method: "POST",
    body: JSON.stringify({ kind }),
  });

export const listBriefings = (args?: { kind?: "EXECUTIVE" | "FORECAST"; take?: number }) => {
  const params = new URLSearchParams();
  if (args?.kind) params.append("kind", args.kind);
  params.append("take", String(args?.take ?? 20));
  return customFetch<{ data: Briefing[]; total: number }>(`/briefings?${params.toString()}`);
};

export const deleteBriefing = (id: string) =>
  customFetch(`/briefings/${id}`, { method: "DELETE" });

// ==========================================
// NOTIFICATIONS (PRO)
// ==========================================

export type NotificationLogRow = {
  id: string;
  channel: "EMAIL" | "PUSH";
  status: "SENT" | "FAILED" | "SKIPPED";
  template: string;
  recipient: string;
  subject: string | null;
  error: string | null;
  createdAt: string;
};

export const getNotificationLog = (args?: {
  channel?: "EMAIL" | "PUSH";
  limit?: number;
}) => {
  const params = new URLSearchParams();
  if (args?.channel) params.append("channel", args.channel);
  params.append("limit", String(args?.limit ?? 25));
  return customFetch<{
    data: NotificationLogRow[];
    totals: { emailSent: number; pushSent: number; failed: number };
  }>(`/notifications/log?${params.toString()}`);
};

// ==========================================
// DISH REVIEWS
// ==========================================

export type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  /** Display name only — the API never exposes a reviewer's email or id. */
  author: string;
  authorImage: string | null;
  createdAt: string;
};

export type DishReviews = {
  data: ReviewRow[];
  averageRating: number;
  totalReviews: number;
  /** Star count per value, 5 down to 1 — what makes a 3.6 legible. */
  breakdown: { star: number; count: number }[];
  totalItems: number;
  itemsPerPage: number;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

export const fetchDishReviews = ({
  menuItemId,
  page,
}: {
  menuItemId: string;
  page: number;
}) => {
  return customFetch<DishReviews>(
    `/menu/${menuItemId}/feedback?page=${page}`,
  );
};

/**
 * Rate a dish.
 *
 * The server upserts: a second submission from the same person edits their
 * first review rather than stacking another one onto the average, so the UI
 * does not need to check whether a review already exists.
 */
export const submitDishReview = ({
  menuItemId,
  rating,
  comment,
}: {
  menuItemId: string;
  rating: number;
  comment?: string;
}) => {
  return customFetch<{ message: string }>(`/menu/${menuItemId}/feedback`, {
    method: "POST",
    body: JSON.stringify({ rating, comment }),
  });
};

export const deleteDishReview = ({ id }: { id: string }) => {
  return customFetch<{ message: string }>(`/menu/feedback/${id}`, {
    method: "DELETE",
  });
};

// ==========================================
// WAITLIST
// ==========================================

export type WaitlistStatus = "WAITING" | "SEATED" | "NO_SHOW" | "CANCELLED";

export type WaitlistEntry = {
  id: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  guests: number;
  notes: string | null;
  table: { id: string; name: string; seats: number } | null;
  /** 1-based queue position, derived from arrival time server-side. */
  position: number;
  waitingMinutes: number;
  estimatedWaitMinutes: number | null;
  createdAt: string;
};

export type WaitlistBoard = {
  waiting: WaitlistEntry[];
  recent: {
    id: string;
    customerName: string;
    guests: number;
    status: WaitlistStatus;
    table: { id: string; name: string; seats: number } | null;
    seatedAt: string | null;
    createdAt: string;
  }[];
  stats: {
    waiting: number;
    seatedToday: number;
    coversWaiting: number;
    /** Mean wait over parties actually seated today; null when there are none. */
    averageWaitMinutes: number | null;
  };
};

export const getWaitlist = () =>
  customFetch<{ data: WaitlistBoard; serverTime: string }>("/waitlist");

/**
 * Public queue depth for the join page.
 *
 * Intentionally carries no names or contact details — a walk-in who has not
 * given their details yet gets to see whether queueing is worthwhile without
 * the queue becoming a directory of everyone else waiting.
 */
export const getPublicWaitlist = () =>
  customFetch<{
    data: {
      partiesAhead: number;
      coversAhead: number;
      averageWaitMinutes: number | null;
      longestWaitMinutes: number;
      accepting: boolean;
    };
    serverTime: string;
  }>("/waitlist/public");

export const joinWaitlist = ({
  customerName,
  phone,
  email,
  guests,
  notes,
}: {
  customerName: string;
  phone?: string;
  email?: string;
  guests: number;
  notes?: string;
}) => {
  return customFetch<{
    data: { id: string; customerName: string; guests: number; position: number };
    message: string;
  }>("/waitlist/join", {
    method: "POST",
    body: JSON.stringify({ customerName, phone, email, guests, notes }),
  });
};

export const updateWaitlistStatus = ({
  id,
  status,
  tableId,
  notes,
}: {
  id: string;
  status: WaitlistStatus;
  /** Passing a table id while seating also marks that table occupied. */
  tableId?: string | null;
  notes?: string;
}) => {
  return customFetch<{ data: unknown }>(`/waitlist/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, tableId, notes }),
  });
};

export const removeWaitlistEntry = ({ id }: { id: string }) => {
  return customFetch<{ message: string }>(`/waitlist/${id}/delete`, {
    method: "DELETE",
  });
};

// ==========================================
// INVENTORY
// ==========================================

export type StockLevel = "OUT" | "LOW" | "OK";

export type Ingredient = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  reorderAt: number;
  costPerUnit: number | null;
  level: StockLevel;
  usedIn: { menuItemId: string; name: string; perServing: number }[];
  updatedAt: string;
};

export type RecipeLine = {
  ingredientId: string;
  name: string;
  unit: string;
  onHand: number;
  perServing: number;
  /** Servings of this dish the current stock supports; null if untracked. */
  servingsLeft: number | null;
};

export type DishRecipe = {
  id: string;
  name: string;
  isAvailable: boolean;
  ingredientCount: number;
  items: RecipeLine[];
};

export const getInventory = () =>
  customFetch<{
    data: Ingredient[];
    lowStock: string[];
    counts: { total: number; low: number };
    serverTime: string;
  }>("/inventory");

export const getRecipes = () =>
  customFetch<{ data: DishRecipe[]; serverTime: string }>("/inventory/recipes");

export const getStockMovements = (limit = 50) =>
  customFetch<{
    data: {
      id: string;
      ingredient: string;
      unit: string;
      delta: number;
      reason: string;
      orderId: string | null;
      note: string | null;
      createdAt: string;
    }[];
    serverTime: string;
  }>(`/inventory/movements?limit=${limit}`);

export const createIngredient = ({
  name,
  unit,
  quantity,
  reorderAt,
  costPerUnit,
}: {
  name: string;
  unit?: string;
  quantity?: number;
  reorderAt?: number;
  costPerUnit?: number;
}) => {
  return customFetch<Ingredient>("/inventory/create", {
    method: "POST",
    body: JSON.stringify({ name, unit, quantity, reorderAt, costPerUnit }),
  });
};

export const updateIngredient = ({
  id,
  name,
  unit,
  reorderAt,
  costPerUnit,
}: {
  id: string;
  name?: string;
  unit?: string;
  reorderAt?: number;
  costPerUnit?: number | null;
}) => {
  return customFetch<Ingredient>(`/inventory/update/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name, unit, reorderAt, costPerUnit }),
  });
};

/**
 * Correct a balance by a signed amount.
 *
 * `reason` is why, not how: RESTOCK for a delivery, WASTE for spoilage,
 * ADJUSTMENT for a recount. It is the only thing that makes a stock ledger
 * worth keeping, so it is not optional.
 */
export const restockIngredient = ({
  id,
  delta,
  reason,
  note,
}: {
  id: string;
  delta: number;
  reason: "RESTOCK" | "WASTE" | "ADJUSTMENT";
  note?: string;
}) => {
  return customFetch<Ingredient>(`/inventory/restock/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ delta, reason, note }),
  });
};

export const deleteIngredient = ({ id }: { id: string }) => {
  return customFetch<{ message: string }>(`/inventory/delete/${id}`, {
    method: "DELETE",
  });
};

/** Replaces a dish's whole recipe in one call, so a line can be removed too. */
export const setRecipe = ({
  menuItemId,
  items,
}: {
  menuItemId: string;
  items: { ingredientId: string; quantity: number }[];
}) => {
  return customFetch<{ data: unknown }>(`/inventory/recipes/${menuItemId}`, {
    method: "POST",
    body: JSON.stringify({ items }),
  });
};

// ==========================================
// SALES ANALYTICS
// ==========================================

export type SalesHeatmap = {
  /** Seven rows, Sunday first, each holding 24 hourly buckets. */
  days: { day: string; hours: number[]; revenue: number[]; orders: number[] }[];
  maxRevenue: number;
  peak: { day: string; hour: number; revenue: number };
  weeks: number;
  since: string;
};

export type TopItem = {
  id: string;
  name: string;
  image: string | null;
  isAvailable: boolean;
  category: string;
  quantity: number;
  revenue: number;
};

export const getSalesAnalytics = () =>
  customFetch<{
    data: {
      heatmap: SalesHeatmap;
      topItems: TopItem[];
      totals: { trackedRevenue: number };
    };
    serverTime: string;
  }>("/dashboard/sales-analytics");

/**
 * Centralised React Query key factory.
 *
 * Why this exists: the app used to spell keys out inline at every call site
 * (`["orders", userId, page]` here, `["orders"]` there). When the shapes drift
 * apart, invalidation silently stops matching and screens go stale — or worse,
 * everything gets nuked on every socket event because the only safe move was a
 * broad prefix invalidation.
 *
 * Rules for this file:
 * - Every key is a plain array so `invalidateQueries` prefix matching works.
 * - `all` is the broad prefix: invalidating it refreshes every variant.
 * - Anything list-shaped takes its filters as trailing segments, so a page
 *   change is a cache miss (correct) rather than a stale hit (wrong).
 */

export const qk = {
  // ── Dashboard ──────────────────────────────────────────────────────────
  dashboard: {
    all: ["dashboard"] as const,
    stats: ["dashboard", "stats"] as const,
    charts: ["dashboard", "charts"] as const,
    lists: ["dashboard", "lists"] as const,
  },

  // ── Orders ─────────────────────────────────────────────────────────────
  orders: {
    all: ["orders"] as const,
    /** Paginated history. `userId` undefined = the admin/all-orders view. */
    list: (userId: string | undefined, page: number) =>
      ["orders", "list", userId ?? "all", page] as const,
    /**
     * Today's still-open orders (PENDING / PREPARING / READY).
     * Backs the Kitchen Display and the Active Orders board — deliberately a
     * different key from `list` so a kitchen refetch never drags history along.
     */
    active: ["orders", "active"] as const,
    /** The till's richer view of the same open orders (adds money + payment). */
    activePos: ["orders", "active", "pos"] as const,
    /**
     * A single order fetched for a receipt reprint.
     *
     * Fetched on demand rather than read from the board's cache: the board
     * payload has no line prices, so a reprint needs its own request. Cached
     * normally, because a receipt for a settled order never changes.
     */
    receipt: (id: string) => ["orders", "receipt", id] as const,
  },

  // ── Tables & floor plan ────────────────────────────────────────────────
  tables: {
    all: ["tables"] as const,
    /** Public, unauthenticated table list used by the booking page. */
    public: ["public-tables"] as const,
  },

  // ── Menu ───────────────────────────────────────────────────────────────
  menu: {
    all: ["menus"] as const,
    list: (page: number) => ["menus", page] as const,
    item: (id: string | undefined) => ["item", id] as const,
    categories: ["categories"] as const,
    /**
     * Reviews for one dish.
     *
     * Separate from `menu.all` on purpose: a review changes a dish's average
     * rating, but the menu list is fetched far more often and is much larger.
     * Invalidating the menu on every review would refetch the whole menu to
     * redraw five stars. The average is corrected in place instead.
     */
    reviews: (menuItemId: string | undefined, page: number) =>
      ["menu-reviews", menuItemId, page] as const,
    /**
     * Every dish's reviews, for a single dish's worth of unknown id.
     *
     * A `menu-updated` socket event carries no dish id, so the only correct
     * scope is "all reviews". In practice one open dialog is mounted at a
     * time, so this invalidates one query — and it must not be widened to
     * `menu.all`, which would drag the full menu along.
     */
    reviewsRoot: ["menu-reviews"] as const,
  },

  // ── Waitlist ───────────────────────────────────────────────────────────
  waitlist: {
    all: ["waitlist"] as const,
    /** The host's board: queue plus what was seated today. */
    board: ["waitlist", "board"] as const,
    /**
     * Public depth for the join page.
     *
     * Deliberately its own key rather than a member of `board`: the public
     * payload has no names, and a guest must never receive a cached board
     * because a poll or a socket event invalidated the wrong thing.
     */
    public: ["waitlist", "public"] as const,
  },

  // ── Inventory ──────────────────────────────────────────────────────────
  inventory: {
    all: ["inventory"] as const,
    // The `{ ingredients, lowStock }` envelope from GET /inventory.
    ingredients: ["inventory", "ingredients"] as const,
    /**
     * The same endpoint unwrapped to just the ingredient array.
     *
     * Deliberately a separate key from `ingredients`: the recipe editor needs
     * the bare list, and sharing one key across two different return shapes
     * meant the last-mounted tab clobbered the other and crashed on read.
     */
    ingredientList: ["inventory", "ingredient-list"] as const,
    recipes: ["inventory", "recipes"] as const,
    movements: (limit: number) => ["inventory", "movements", limit] as const,
  },

  // ── Reservations ───────────────────────────────────────────────────────
  reservations: {
    all: ["reservations"] as const,
    list: (userId: string | undefined) =>
      ["reservations", userId ?? "all"] as const,
  },

  // ── Admin ──────────────────────────────────────────────────────────────
  activitiesLog: {
    all: ["activitiesLog"] as const,
    list: (page: number) => ["activitiesLog", page] as const,
  },
  notificationLog: ["notification-log"] as const,

  // ── AI briefings (pro) ─────────────────────────────────────────────────
  briefings: {
    all: ["briefings"] as const,
    latest: ["briefings", "latest"] as const,
    metrics: ["briefing-metrics"] as const,
  },

  // ── Reports ────────────────────────────────────────────────────────────
  reports: {
    all: ["reports"] as const,
    /** `date` omitted = today's service day. */
    dayClose: (date?: string) =>
      ["reports", "day-close", date ?? "today"] as const,
  },

  /**
   * Sales analytics, split from the other dashboard panels.
   *
   * `dashboard.all` covers it, so a socket-driven refetch of the existing
   * panels cannot accidentally drag the twelve-week grid along with it.
   */
  analytics: {
    all: ["dashboard", "sales-analytics"] as const,
  },
} as const;

/**
 * Keys that a table mutation can affect.
 *
 * The floor plan and the public booking page read the same underlying tables
 * through two different endpoints. The public one (`["public-tables"]`) does not
 * share a prefix with `["tables"]`, so invalidating `qk.tables.all` alone leaves
 * the customer-facing page stale. Both are returned here so callers cannot
 * forget one.
 */
export const tableDependentKeys = [qk.tables.all, qk.tables.public] as const;

/**
 * Safety-net poll for screens that are also socket-driven.
 *
 * These endpoints used to poll every 60 seconds. Socket events now carry
 * freshness, so polling is only a backstop for a dropped socket; five minutes
 * is enough to self-heal without burning quota all day.
 */
export const SAFETY_POLL_MS = 5 * 60_000;

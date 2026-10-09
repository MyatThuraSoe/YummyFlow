import type { Request, Response, NextFunction } from "express";

/**
 * A small fixed-window rate limiter.
 *
 * Written by hand rather than pulled from npm so the app carries no new
 * dependency for what is ~40 lines of bookkeeping. It is deliberately simple:
 * per-process counters in a Map, swept on a timer.
 *
 * ---------------------------------------------------------------------------
 * SCOPE — read this before trusting it in production
 * ---------------------------------------------------------------------------
 * Counters live in this process's heap. With a single Node instance that is
 * correct. Behind a load balancer with N instances the effective limit is N ×
 * the number below, because each process counts independently. Moving to Redis
 * (`INCR` + `EXPIRE`) is the standard fix and is the only thing that needs to
 * change if you ever scale out.
 *
 * `Retry-After` and `X-RateLimit-*` are set on every response so a client can
 * back off sensibly instead of retrying into a wall.
 */

/** One window's worth of counters. */
type Bucket = { count: number; resetAt: number };

/** Buckets keyed by limiter name, then by client key. */
const buckets = new Map<string, Map<string, Bucket>>();

/** Sweep expired buckets so the Map cannot grow without bound. */
const SWEEP_INTERVAL_MS = 60_000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const store of buckets.values()) {
    for (const [key, bucket] of store) {
      if (bucket.resetAt <= now) store.delete(key);
    }
  }
}, SWEEP_INTERVAL_MS);

// Never hold the process open just for the sweeper.
sweeper.unref?.();

export type RateLimitOptions = {
  /** Identifies this limiter's counter space. */
  name: string;
  /** Allowed requests per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /**
   * Rate limit per signed-in user id rather than per IP. Used where a single
   * office/café NAT would otherwise throttle every waiter behind one address.
   * Falls back to the IP when there is no session.
   */
  perUser?: boolean;
  /** Overridable for tests. */
  now?: () => number;
};

const clientIp = (req: Request): string => {
  // `trust proxy` is set in server.ts, so this is the real client address rather
  // than the load balancer's.
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
  return typeof ip === "string" ? ip : "unknown";
};

const clientKey = (req: Request, perUser: boolean): string => {
  if (perUser) {
    const userId = (req as any).user?.id;
    if (typeof userId === "string" && userId) return `u:${userId}`;
  }
  return `ip:${clientIp(req)}`;
};

export const rateLimit = ({
  name,
  limit,
  windowMs,
  perUser = false,
  now = Date.now,
}: RateLimitOptions) => {
  let store = buckets.get(name);
  if (!store) {
    store = new Map<string, Bucket>();
    buckets.set(name, store);
  }
  const counterStore = store;

  return (req: Request, res: Response, next: NextFunction) => {
    const at = now();
    const key = clientKey(req, perUser);

    let bucket = counterStore.get(key);
    if (!bucket || bucket.resetAt <= at) {
      bucket = { count: 0, resetAt: at + windowMs };
      counterStore.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, limit - bucket.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - at) / 1000),
    );

    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: "Too many requests — please slow down.",
        retryAfterSeconds,
      });
    }

    return next();
  };
};

/* ------------------------------------------------------------------ */
/* Named limiters                                                       */
/* ------------------------------------------------------------------ */

/**
 * Public, unauthenticated writes.
 *
 * These are the endpoints anyone on the internet can hit, so they get the
 * tightest budget. Before this existed, a self-registered customer could call
 * `POST /reservations/create` in a loop and push a "new table booking"
 * notification to every manager's phone, as fast as the server would answer.
 */
export const publicWriteLimiter = rateLimit({
  name: "public-write",
  limit: 5,
  windowMs: 60_000,
});

/**
 * A walk-in joining the queue. A genuine guest does this once; a flood does it
 * hundreds of times. Per-IP because there is no account at the door.
 */
export const waitlistJoinLimiter = rateLimit({
  name: "waitlist-join",
  limit: 5,
  windowMs: 10 * 60_000,
});

/**
 * A diner submitting or editing a review. Requires a session, so it is counted
 * per user — several guests can share one restaurant wifi without tripping it.
 */
export const reviewLimiter = rateLimit({
  name: "review",
  limit: 10,
  windowMs: 10 * 60_000,
  perUser: true,
});

/**
 * Anything that spends money on the operator's behalf: the AI generators, the
 * briefing triggers, the notifications test hooks. Keyed per user so one
 * enthusiastic clicker cannot burn the Gemini quota for everyone.
 */
export const expensiveOpLimiter = rateLimit({
  name: "expensive-op",
  limit: 10,
  windowMs: 60 * 60_000,
  perUser: true,
});

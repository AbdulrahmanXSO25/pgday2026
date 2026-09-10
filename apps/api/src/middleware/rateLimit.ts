import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";

/**
 * Rate-limit stub — DB-backed in production via `rate_limits` table (§12),
 * but for subtask 03 it is a no-op that preserves the DI shape.
 *
 * Factory accepts `db` via closure (injection), not direct import,
 * so routes never import D1/better-sqlite3 directly.
 *
 * Behaviour:
 *  - Adds `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers (stub values).
 *  - Does NOT block requests yet — will be implemented in Phase 6 using
 *    `rate_limits` table with windowStart/count keyed by IP+route.
 *
 * Usage:
 *   app.use('*', createRateLimitMiddleware({ windowMs: 60_000, max: 5 }))
 *   // or DI variant:
 *   app.use('*', createDbRateLimitMiddleware(db))
 */

export type RateLimitOptions = {
  windowMs?: number;
  max?: number;
  keyGenerator?: (c: { req: { header(n: string): string | undefined } }) => string;
};

// In-memory fallback for local tests — NOT used for prod limiter.
// Kept tiny and pure: map key -> { count, windowStart }
type Bucket = { count: number; windowStart: number };
const memoryBuckets = new Map<string, Bucket>();

function defaultKeyGenerator(c: { req: { header(n: string): string | undefined } }): string {
  // Prefer forwarded IP, fallback to synthetic key for tests
  const fwd = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "";
  const ip = fwd.split(",")[0]?.trim() || "anon";
  return `global:${ip}`;
}

export function createRateLimitMiddleware(
  options: RateLimitOptions = {}
): MiddlewareHandler<AppEnv> {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 60;
  const keyGen = options.keyGenerator ?? defaultKeyGenerator;

  return async (c, next) => {
    const key = keyGen(c as unknown as Parameters<typeof keyGen>[0]);
    const now = Date.now();

    // Stub bookkeeping — keeps header correctness without blocking
    let bucket = memoryBuckets.get(key);
    if (!bucket || now - bucket.windowStart > windowMs) {
      bucket = { count: 0, windowStart: now };
      memoryBuckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil((bucket.windowStart + windowMs) / 1000)));

    // Stub does NOT return 429 — real limiter will when remaining < 0 and db check fails
    await next();
  };
}

/**
 * Shorthand default export used in app.ts
 */
export function rateLimitMiddleware(): MiddlewareHandler<AppEnv> {
  return createRateLimitMiddleware();
}

/**
 * DB-backed variant — DI shape for Phase 6.
 * Accepts any `db` handle (better-sqlite3 or D1) but currently delegates to in-memory.
 * Keeping signature stable so route files don't change when DB logic lands.
 */
export function createDbRateLimitMiddleware(
  _db: unknown,
  options: RateLimitOptions = {}
): MiddlewareHandler<AppEnv> {
  // _db reserved for future SELECT/INSERT into rate_limits
  void _db;
  return createRateLimitMiddleware(options);
}

// Test helper — clear buckets between tests
export function __clearRateLimitBuckets(): void {
  memoryBuckets.clear();
}

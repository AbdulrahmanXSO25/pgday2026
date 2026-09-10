import { eq } from "drizzle-orm";
import { rateLimits } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";

/**
 * Generic fixed-window rate limiting on the `rate_limits` table (§18.2 pattern).
 * Pure composition, Drizzle-agnostic sync/async handling, no globals.
 */

async function selectAll(query: unknown): Promise<unknown[]> {
  const q = query as Record<string, unknown>;
  if (typeof q.all === "function") {
    const res = (q.all as () => unknown)();
    const awaited = res instanceof Promise ? await res : res;
    if (Array.isArray(awaited)) return awaited;
    if (
      awaited &&
      typeof awaited === "object" &&
      "results" in (awaited as Record<string, unknown>)
    ) {
      return ((awaited as Record<string, unknown>).results as unknown[]) ?? [];
    }
    return Array.isArray(awaited) ? awaited : [];
  }
  const res = await (query as Promise<unknown>);
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && "results" in (res as Record<string, unknown>)) {
    return ((res as Record<string, unknown>).results as unknown[]) ?? [];
  }
  return [];
}

async function runQuery(query: unknown): Promise<void> {
  const q = query as Record<string, unknown>;
  if (typeof q.run === "function") {
    const res = (q.run as () => unknown)();
    if (res instanceof Promise) await res;
    return;
  }
  await (query as Promise<unknown>);
}

export type RateLimitOptions = {
  key: string;
  max: number;
  windowSec: number;
  nowMs?: number;
};

/** Returns true when the caller is over the limit (does NOT increment). */
export async function isRateLimited(db: Db, opts: RateLimitOptions): Promise<boolean> {
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const rows = await selectAll(db.select().from(rateLimits).where(eq(rateLimits.key, opts.key)));
  const existing = (rows[0] as typeof rateLimits.$inferSelect) ?? null;
  if (!existing) return false;
  const windowExpired = nowSec - (existing.windowStart as number) >= opts.windowSec;
  if (windowExpired) return false;
  return (existing.count as number) >= opts.max;
}

/** Increments the window counter (creates the row on first hit). */
export async function recordRateLimitHit(db: Db, opts: RateLimitOptions): Promise<void> {
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const rows = await selectAll(db.select().from(rateLimits).where(eq(rateLimits.key, opts.key)));
  const existing = (rows[0] as typeof rateLimits.$inferSelect) ?? null;

  if (!existing) {
    try {
      await runQuery(
        db
          .insert(rateLimits)
          .values({ key: opts.key, windowStart: nowSec, count: 1, updatedAt: nowSec } as never)
      );
    } catch {
      // race — fall through to update
      await runQuery(
        db
          .update(rateLimits)
          .set({ count: 1, windowStart: nowSec, updatedAt: nowSec } as never)
          .where(eq(rateLimits.key, opts.key))
      );
    }
    return;
  }

  const windowExpired = nowSec - (existing.windowStart as number) >= opts.windowSec;
  if (windowExpired) {
    await runQuery(
      db
        .update(rateLimits)
        .set({ windowStart: nowSec, count: 1, updatedAt: nowSec } as never)
        .where(eq(rateLimits.key, opts.key))
    );
    return;
  }

  await runQuery(
    db
      .update(rateLimits)
      .set({ count: (existing.count as number) + 1, updatedAt: nowSec } as never)
      .where(eq(rateLimits.key, opts.key))
  );
}

/** Clears a counter (e.g., on successful login). */
export async function clearRateLimit(db: Db, key: string): Promise<void> {
  try {
    await runQuery(db.delete(rateLimits).where(eq(rateLimits.key, key)));
  } catch {
    // best effort
  }
}

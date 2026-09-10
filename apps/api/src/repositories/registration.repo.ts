import { eq, and, isNull, desc } from "drizzle-orm";
import { events, registrations, rateLimits } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";

// ---------------------------------------------------------------------------
// Constants — pure, no side effects
// ---------------------------------------------------------------------------
export const DEFAULT_EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";
export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_SEC = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Helpers — small pure functions
// ---------------------------------------------------------------------------

function isUniqueConstraintError(message: string): boolean {
  return /UNIQUE|constraint/i.test(message);
}

/**
 * Resolve rate_limits key for IP.
 * Pure function.
 */
export function rateLimitKey(ip: string): string {
  return `registrations:${ip}`;
}

// ---------------------------------------------------------------------------
// Repository — DI via `db` param, no globals, explicit errors
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Drizzle helpers — handle both better-sqlite3 (sync, .all/.get/.run) and D1 (async thenable)
// ---------------------------------------------------------------------------

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
  // D1 thenable
  const res = await (query as Promise<unknown>);
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && "results" in (res as Record<string, unknown>)) {
    return ((res as Record<string, unknown>).results as unknown[]) ?? [];
  }
  return [];
}

async function selectOne<T>(query: unknown): Promise<T | null> {
  const q = query as Record<string, unknown>;
  if (typeof q.get === "function") {
    const res = (q.get as () => unknown)();
    const awaited = res instanceof Promise ? await res : res;
    return (awaited as T) ?? null;
  }
  const all = await selectAll(query);
  return (all[0] as T) ?? null;
}

async function runQuery(query: unknown): Promise<void> {
  const q = query as Record<string, unknown>;
  if (typeof q.run === "function") {
    const res = (q.run as () => unknown)();
    if (res instanceof Promise) await res;
    return;
  }
  // D1 thenable without .run() — just await
  await (query as Promise<unknown>);
}

/**
 * Check that event exists and is not soft-deleted.
 * Returns event row or null.
 */
export async function findEventById(db: Db, eventId: string): Promise<{ id: string } | null> {
  const query = db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)));
  return selectOne<{ id: string }>(query);
}

/**
 * Pre-check duplicate: same event_id + email (lowercase) and not soft-deleted.
 */
export async function findRegistrationByEventEmail(
  db: Db,
  eventId: string,
  email: string
): Promise<{ id: string } | null> {
  const normalized = email.trim().toLowerCase();
  const query = db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.email, normalized),
        isNull(registrations.deletedAt)
      )
    );
  return selectOne<{ id: string }>(query);
}

/**
 * Insert registration. Throws on UNIQUE violation for caller to map to 409.
 */
export async function insertRegistration(
  db: Db,
  data: {
    id: string;
    eventId: string;
    name: string;
    email: string;
    organization?: string;
    role?: string;
    dietaryNotes?: string;
    status?: string;
  }
): Promise<{ id: string }> {
  const id = data.id;
  const now = Math.floor(Date.now() / 1000);
  try {
    await runQuery(
      db.insert(registrations).values({
        id,
        eventId: data.eventId,
        name: data.name,
        email: data.email.trim().toLowerCase(),
        organization: data.organization ?? null,
        role: data.role ?? null,
        dietaryNotes: data.dietaryNotes ?? null,
        status: (data.status as never) ?? "pending",
        createdAt: now,
        updatedAt: now,
      } as never)
    );
    return { id };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Re-throw with marker so service can detect UNIQUE vs generic
    if (isUniqueConstraintError(msg)) {
      const e = new Error(msg);
      (e as unknown as Record<string, unknown>).__isUniqueViolation = true;
      throw e;
    }
    throw error;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error) return false;
  const flagged = (error as Record<string, unknown>).__isUniqueViolation === true;
  if (flagged) return true;
  const msg = error instanceof Error ? error.message : String(error);
  return isUniqueConstraintError(msg);
}

/**
 * List registrations — admin view, filtered, latest first.
 * Supports optional eventId, status, and pagination via limit/offset.
 */
export async function listRegistrations(
  db: Db,
  filters: { eventId?: string; status?: string; limit?: number; offset?: number } = {}
): Promise<Array<typeof registrations.$inferSelect>> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  // Build where clauses declaratively
  const whereClauses: ReturnType<typeof eq>[] = [];
  if (filters.eventId) whereClauses.push(eq(registrations.eventId, filters.eventId));
  if (filters.status) whereClauses.push(eq(registrations.status, filters.status as never));
  // Soft-delete filter — always exclude deleted
  const baseQuery = db
    .select()
    .from(registrations)
    .where(
      whereClauses.length > 0
        ? and(isNull(registrations.deletedAt), ...whereClauses)
        : isNull(registrations.deletedAt)
    )
    .orderBy(desc(registrations.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = await selectAll(baseQuery);
  return rows as Array<typeof registrations.$inferSelect>;
}

/**
 * Rate limit check + increment (DB-backed).
 * Returns true if limit exceeded (should return 429), false otherwise.
 * Logic:
 * - key = `registrations:${ip}`
 * - window = 1 hour, max 5
 * - If no row: insert count=1 windowStart=now → not limited
 * - If window expired: reset count=1 windowStart=now → not limited
 * - If count >= 5 within window → limited
 * - Else increment count → not limited
 *
 * Pure side-effect on DB, but deterministic for same inputs.
 */
export async function checkRateLimit(
  db: Db,
  ip: string,
  nowMs: number = Date.now()
): Promise<boolean> {
  const key = rateLimitKey(ip);
  const nowSec = Math.floor(nowMs / 1000);

  const query = db.select().from(rateLimits).where(eq(rateLimits.key, key));
  const rows = await selectAll(query);
  const existing = (rows[0] as typeof rateLimits.$inferSelect) ?? null;

  if (!existing) {
    // First request in window
    try {
      await runQuery(
        db.insert(rateLimits).values({
          key,
          windowStart: nowSec,
          count: 1,
          updatedAt: nowSec,
        } as never)
      );
    } catch {
      // Race on first insert — treat as increment path
      return false;
    }
    return false;
  }

  const windowStart = existing.windowStart as number;
  const windowExpired = nowSec - windowStart >= RATE_LIMIT_WINDOW_SEC;

  if (windowExpired) {
    await runQuery(
      db
        .update(rateLimits)
        .set({ windowStart: nowSec, count: 1, updatedAt: nowSec } as never)
        .where(eq(rateLimits.key, key))
    );
    return false;
  }

  if ((existing.count as number) >= RATE_LIMIT_MAX) {
    return true;
  }

  await runQuery(
    db
      .update(rateLimits)
      .set({ count: (existing.count as number) + 1, updatedAt: nowSec } as never)
      .where(eq(rateLimits.key, key))
  );

  return false;
}

/**
 * Utility: get client IP from Hono context (pure helper, not DB).
 * Exported for reuse in service/route.
 */
export function getClientIpFromHeaders(headers: {
  get(name: string): string | null | undefined;
}): string {
  const cf = headers.get("CF-Connecting-IP");
  if (cf && cf.trim().length > 0) return cf.trim();
  const xff = headers.get("X-Forwarded-For");
  if (xff && xff.trim().length > 0) return xff.split(",")[0].trim();
  const xrip = headers.get("X-Real-IP");
  if (xrip && xrip.trim().length > 0) return xrip.trim();
  return "unknown";
}

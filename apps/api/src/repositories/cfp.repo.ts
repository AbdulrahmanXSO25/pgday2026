import { eq, and, isNull, desc } from "drizzle-orm";
import { events, cfpSubmissions, cfpSubmissionSpeakers, rateLimits } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";

// ---------------------------------------------------------------------------
// Constants — pure, no side effects
// ---------------------------------------------------------------------------
export const DEFAULT_EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";
export const CFP_RATE_LIMIT_MAX = 5;
export const CFP_RATE_LIMIT_WINDOW_SEC = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Helpers — small pure functions
// ---------------------------------------------------------------------------
export function cfpRateLimitKey(ip: string): string {
  return `cfp:${ip}`;
}

function isUniqueConstraintError(message: string): boolean {
  return /UNIQUE|constraint/i.test(message);
}

// ---------------------------------------------------------------------------
// Drizzle helpers — handle both better-sqlite3 (sync .all/.get/.run) and D1 (async)
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
  await (query as Promise<unknown>);
}

// ---------------------------------------------------------------------------
// Repository — DI via `db` param, no globals
// ---------------------------------------------------------------------------

export async function findEventById(db: Db, eventId: string): Promise<{ id: string } | null> {
  const query = db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)));
  return selectOne<{ id: string }>(query);
}

export type CreateCfpSubmissionInput = {
  id: string;
  eventId: string;
  title: string;
  abstract: string;
  track?: string;
  level?: string;
  status?: string;
  submitterName: string;
  submitterEmail: string;
  submitterBio?: string;
  speakers: Array<{
    id: string;
    name: string;
    email: string;
    bio?: string;
    company?: string;
    role?: string;
    isPrimary: number;
  }>;
};

/**
 * Transactionally insert cfp_submissions + cfp_submission_speakers.
 * Uses db.transaction when available; falls back to sequential inserts.
 * Handles both better-sqlite3 (sync tx) and D1 (async).
 */
export async function createCfpSubmissionTransactional(
  db: Db,
  data: CreateCfpSubmissionInput
): Promise<{ id: string }> {
  const now = Math.floor(Date.now() / 1000);
  const submissionValues = {
    id: data.id,
    eventId: data.eventId,
    title: data.title,
    abstract: data.abstract,
    track: data.track ?? null,
    level: data.level ?? null,
    status: (data.status as never) ?? "submitted",
    submitterName: data.submitterName,
    submitterEmail: data.submitterEmail.trim().toLowerCase(),
    submitterBio: data.submitterBio ?? null,
    createdAt: now,
    updatedAt: now,
  } as never;

  const speakerRows = data.speakers.map(
    (s) =>
      ({
        id: s.id,
        submissionId: data.id,
        name: s.name,
        email: s.email.trim().toLowerCase(),
        bio: s.bio ?? null,
        company: s.company ?? null,
        role: s.role ?? null,
        isPrimary: s.isPrimary,
        createdAt: now,
      }) as never
  );

  // Attempt transactional insert if db.transaction exists
  const maybeTx = (db as unknown as { transaction?: unknown }).transaction;
  if (typeof maybeTx === "function") {
    try {
      // Wrap in transaction — drizzle better-sqlite3 uses sync callback, D1 uses async
      // We try async style first
      const txFn = maybeTx as (cb: (tx: Db) => Promise<void> | void) => Promise<void> | void;
      const result = txFn.call(db, async (tx: Db) => {
        await runQuery(
          (tx as unknown as { insert: (t: unknown) => { values: (v: unknown) => unknown } })
            .insert(cfpSubmissions)
            .values(submissionValues)
        );
        for (const row of speakerRows) {
          await runQuery(
            (tx as unknown as { insert: (t: unknown) => { values: (v: unknown) => unknown } })
              .insert(cfpSubmissionSpeakers)
              .values(row)
          );
        }
      });
      if (result instanceof Promise) await result;
      return { id: data.id };
    } catch (error) {
      // If transaction fails due to not supporting async, fall back to sequential
      const msg = error instanceof Error ? error.message : String(error);
      if (!isUniqueConstraintError(msg) && !msg.includes("transaction")) {
        // Re-throw if it's not transaction plumbing error — but try sequential as fallback
      }
      // Fallback sequential path below
    }
  }

  // Sequential fallback — still atomic per SQLite but not strictly transactional
  // In practice local better-sqlite3 will have taken the transaction path above
  try {
    await runQuery(db.insert(cfpSubmissions).values(submissionValues));
    for (const row of speakerRows) {
      await runQuery(db.insert(cfpSubmissionSpeakers).values(row));
    }
    return { id: data.id };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
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
 * List submissions filtered by submitterEmail (mine view).
 * Filters soft-deleted, ordered latest first, paginated.
 */
export async function listCfpBySubmitterEmail(
  db: Db,
  filters: { email: string; eventId?: string; limit?: number; offset?: number }
): Promise<Array<typeof cfpSubmissions.$inferSelect>> {
  const email = filters.email.trim().toLowerCase();
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const whereClauses: ReturnType<typeof eq>[] = [];
  whereClauses.push(eq(cfpSubmissions.submitterEmail, email));
  if (filters.eventId) whereClauses.push(eq(cfpSubmissions.eventId, filters.eventId));

  const baseQuery = db
    .select()
    .from(cfpSubmissions)
    .where(and(isNull(cfpSubmissions.deletedAt), ...whereClauses))
    .orderBy(desc(cfpSubmissions.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = await selectAll(baseQuery);
  return rows as Array<typeof cfpSubmissions.$inferSelect>;
}

/**
 * Count speakers for a submission — helper for tests.
 */
export async function countSpeakersForSubmission(db: Db, submissionId: string): Promise<number> {
  const q = db
    .select()
    .from(cfpSubmissionSpeakers)
    .where(eq(cfpSubmissionSpeakers.submissionId, submissionId));
  const rows = await selectAll(q);
  return rows.length;
}

/**
 * DB-backed anonymous IP rate limit for CFP (§34).
 * Same pattern as registrations: 5/hour per IP, key `cfp:${ip}`.
 * Returns true if limited (should return 429).
 */
export async function checkCfpRateLimit(
  db: Db,
  ip: string,
  nowMs: number = Date.now()
): Promise<boolean> {
  const key = cfpRateLimitKey(ip);
  const nowSec = Math.floor(nowMs / 1000);

  const query = db.select().from(rateLimits).where(eq(rateLimits.key, key));
  const rows = await selectAll(query);
  const existing = (rows[0] as typeof rateLimits.$inferSelect) ?? null;

  if (!existing) {
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
      return false;
    }
    return false;
  }

  const windowStart = existing.windowStart as number;
  const windowExpired = nowSec - windowStart >= CFP_RATE_LIMIT_WINDOW_SEC;

  if (windowExpired) {
    await runQuery(
      db
        .update(rateLimits)
        .set({ windowStart: nowSec, count: 1, updatedAt: nowSec } as never)
        .where(eq(rateLimits.key, key))
    );
    return false;
  }

  if ((existing.count as number) >= CFP_RATE_LIMIT_MAX) {
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
 * Utility: get client IP from Hono context headers.
 * Pure helper — priority: CF-Connecting-IP → X-Forwarded-For → X-Real-IP → unknown
 */
export function getCfpClientIpFromHeaders(headers: {
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

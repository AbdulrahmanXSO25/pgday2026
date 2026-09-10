import { eq, and, isNull, desc, like, or } from "drizzle-orm";
import { cfpSubmissions, cfpSubmissionSpeakers, cfpReviews } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import { ApiError } from "../middleware/errorHandler.js";
import { createAuditLog } from "./audit.service.js";

// ---------------------------------------------------------------------------
// Constants — state machine §§19-21
// ---------------------------------------------------------------------------

export const CFP_STATUSES = ["submitted", "under_review", "accepted", "rejected"] as const;
export type CfpStatus = (typeof CFP_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<CfpStatus, CfpStatus[]> = {
  submitted: ["under_review"],
  under_review: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};

export function isValidTransition(from: string, to: string): boolean {
  const allowed = ALLOWED_TRANSITIONS[from as CfpStatus];
  if (!allowed) return false;
  return (allowed as string[]).includes(to);
}

export function assertValidTransition(from: string, to: string): void {
  if (!CFP_STATUSES.includes(from as CfpStatus) || !CFP_STATUSES.includes(to as CfpStatus)) {
    throw new ApiError(409, "CONFLICT", `Invalid status transition: ${from} → ${to}`);
  }
  if (!isValidTransition(from, to)) {
    throw new ApiError(
      409,
      "CONFLICT",
      `Invalid transition: ${from} → ${to}. Allowed: ${ALLOWED_TRANSITIONS[from as CfpStatus]?.join(", ") || "none"}`
    );
  }
}

// ---------------------------------------------------------------------------
// DB helpers — better-sqlite3 sync vs D1 async
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

async function withTransaction(db: Db, fn: (tx: Db) => Promise<void>): Promise<void> {
  // Prefer raw better-sqlite3 transaction via $client for proper sync rollback semantics
  const client = (db as unknown as { $client?: { exec: (sql: string) => void } }).$client;
  if (client && typeof client.exec === "function") {
    client.exec("BEGIN IMMEDIATE");
    try {
      await fn(db);
      client.exec("COMMIT");
    } catch (e) {
      try {
        client.exec("ROLLBACK");
      } catch {}
      throw e;
    }
    return;
  }
  const maybeTx = (db as unknown as { transaction?: unknown }).transaction;
  if (typeof maybeTx === "function") {
    const txFn = maybeTx as (cb: (tx: Db) => Promise<void>) => Promise<void>;
    await txFn.call(db, async (tx: Db) => {
      await fn(tx);
    });
    return;
  }
  await fn(db);
}

// ---------------------------------------------------------------------------
// List — admin view with filters
// ---------------------------------------------------------------------------

export type CfpListFilters = {
  status?: string;
  eventId?: string;
  search?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export async function listCfpSubmissions(
  db: Db,
  filters: CfpListFilters
): Promise<Array<typeof cfpSubmissions.$inferSelect>> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  // Build where clauses
  const clauses: unknown[] = [isNull(cfpSubmissions.deletedAt)];
  if (filters.status) {
    clauses.push(eq(cfpSubmissions.status, filters.status as never));
  }
  if (filters.eventId) {
    clauses.push(eq(cfpSubmissions.eventId, filters.eventId));
  }
  const search = filters.search ?? filters.q;
  if (search && search.trim().length > 0) {
    const term = `%${search.trim()}%`;
    // Use OR across title, submitterName, submitterEmail
    // Drizzle's like works for sqlite
    clauses.push(
      or(
        like(cfpSubmissions.title, term),
        like(cfpSubmissions.submitterName, term),
        like(cfpSubmissions.submitterEmail, term)
      ) as unknown
    );
  }

  const where = clauses.length === 1 ? (clauses[0] as never) : and(...(clauses as never[]));

  const query = db
    .select()
    .from(cfpSubmissions)
    .where(where)
    .orderBy(desc(cfpSubmissions.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = await selectAll(query);
  return rows as Array<typeof cfpSubmissions.$inferSelect>;
}

// ---------------------------------------------------------------------------
// Detail — submission + speakers + reviews
// ---------------------------------------------------------------------------

export type CfpDetail = {
  submission: typeof cfpSubmissions.$inferSelect;
  speakers: Array<typeof cfpSubmissionSpeakers.$inferSelect>;
  reviews: Array<typeof cfpReviews.$inferSelect>;
};

export async function getCfpSubmissionDetail(db: Db, id: string): Promise<CfpDetail> {
  const submission = await selectOne<typeof cfpSubmissions.$inferSelect>(
    db
      .select()
      .from(cfpSubmissions)
      .where(and(eq(cfpSubmissions.id, id), isNull(cfpSubmissions.deletedAt)))
  );
  if (!submission) throw new ApiError(404, "NOT_FOUND", "CFP submission not found");

  const speakers = (await selectAll(
    db.select().from(cfpSubmissionSpeakers).where(eq(cfpSubmissionSpeakers.submissionId, id))
  )) as Array<typeof cfpSubmissionSpeakers.$inferSelect>;

  const reviews = (await selectAll(
    db
      .select()
      .from(cfpReviews)
      .where(eq(cfpReviews.submissionId, id))
      .orderBy(desc(cfpReviews.createdAt))
  )) as Array<typeof cfpReviews.$inferSelect>;

  return { submission, speakers, reviews };
}

// ---------------------------------------------------------------------------
// Transition — state machine with audit + review log, transactional
// ---------------------------------------------------------------------------

export type TransitionInput = {
  submissionId: string;
  targetStatus: CfpStatus;
  reviewerId?: string | null;
  comment?: string | null;
  score?: number | null;
  ip?: string | null;
  userAgent?: string | null;
};

export async function transitionCfpStatus(
  db: Db,
  input: TransitionInput
): Promise<{ submission: typeof cfpSubmissions.$inferSelect; reviewId: string }> {
  const { submissionId, targetStatus, reviewerId, comment, score } = input;

  if (!CFP_STATUSES.includes(targetStatus)) {
    throw new ApiError(409, "CONFLICT", `Invalid target status: ${targetStatus}`);
  }
  if (score !== undefined && score !== null) {
    const s = Number(score);
    if (!Number.isInteger(s) || s < 1 || s > 5) {
      throw new ApiError(422, "VALIDATION_ERROR", "Score must be an integer 1-5");
    }
  }

  const existing = await selectOne<typeof cfpSubmissions.$inferSelect>(
    db
      .select()
      .from(cfpSubmissions)
      .where(and(eq(cfpSubmissions.id, submissionId), isNull(cfpSubmissions.deletedAt)))
  );
  if (!existing) throw new ApiError(404, "NOT_FOUND", "CFP submission not found");

  const from = existing.status as string;
  if (from === targetStatus) {
    throw new ApiError(409, "CONFLICT", `Already in status ${targetStatus}`);
  }
  assertValidTransition(from, targetStatus);

  const now = Math.floor(Date.now() / 1000);
  const reviewId = crypto.randomUUID();

  try {
    await withTransaction(db, async (tx) => {
      await runQuery(
        tx
          .update(cfpSubmissions)
          .set({ status: targetStatus, updatedAt: now } as never)
          .where(eq(cfpSubmissions.id, submissionId))
      );
      await runQuery(
        tx.insert(cfpReviews).values({
          id: reviewId,
          submissionId,
          reviewerId: reviewerId ?? null,
          score: score ?? null,
          comment: comment ?? null,
          statusFrom: from,
          statusTo: targetStatus,
          createdAt: now,
        } as never)
      );
      await createAuditLog(tx as Db, {
        actorId: reviewerId ?? null,
        action: "cfp.status_change",
        targetType: "cfp_submission",
        targetId: submissionId,
        metadata: {
          statusFrom: from,
          statusTo: targetStatus,
          reviewId,
          comment: comment ?? null,
          score: score ?? null,
        },
        ipAddress: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        now: now * 1000,
      });
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      `Failed to transition CFP status: ${msg.slice(0, 200)}`
    );
  }

  const updated = await selectOne<typeof cfpSubmissions.$inferSelect>(
    db.select().from(cfpSubmissions).where(eq(cfpSubmissions.id, submissionId))
  );
  if (!updated) throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch updated submission");
  return { submission: updated, reviewId };
}

// ---------------------------------------------------------------------------
// Add review without status change
// ---------------------------------------------------------------------------

export type AddReviewInput = {
  submissionId: string;
  reviewerId?: string | null;
  comment?: string | null;
  score?: number | null;
  ip?: string | null;
  userAgent?: string | null;
};

export async function addCfpReview(
  db: Db,
  input: AddReviewInput
): Promise<typeof cfpReviews.$inferSelect> {
  const { submissionId, reviewerId, comment, score } = input;

  if (!comment && (score === undefined || score === null)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Comment or score is required");
  }
  if (score !== undefined && score !== null) {
    const s = Number(score);
    if (!Number.isInteger(s) || s < 1 || s > 5) {
      throw new ApiError(422, "VALIDATION_ERROR", "Score must be an integer 1-5");
    }
  }

  const submission = await selectOne<typeof cfpSubmissions.$inferSelect>(
    db
      .select()
      .from(cfpSubmissions)
      .where(and(eq(cfpSubmissions.id, submissionId), isNull(cfpSubmissions.deletedAt)))
  );
  if (!submission) throw new ApiError(404, "NOT_FOUND", "CFP submission not found");

  const now = Math.floor(Date.now() / 1000);
  const reviewId = crypto.randomUUID();

  await runQuery(
    db.insert(cfpReviews).values({
      id: reviewId,
      submissionId,
      reviewerId: reviewerId ?? null,
      score: score ?? null,
      comment: comment ?? null,
      statusFrom: null,
      statusTo: null,
      createdAt: now,
    } as never)
  );

  await createAuditLog(db, {
    actorId: reviewerId ?? null,
    action: "cfp.review",
    targetType: "cfp_submission",
    targetId: submissionId,
    metadata: { reviewId, comment: comment ?? null, score: score ?? null },
    ipAddress: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    now: now * 1000,
  });

  const created = await selectOne<typeof cfpReviews.$inferSelect>(
    db.select().from(cfpReviews).where(eq(cfpReviews.id, reviewId))
  );
  if (!created) throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch created review");
  return created;
}

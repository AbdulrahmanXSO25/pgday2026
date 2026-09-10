import { eq, and, isNull } from "drizzle-orm";
import {
  cfpSubmissions,
  cfpSubmissionSpeakers,
  speakers,
  sessions,
  sessionSpeakers,
  auditLogs,
} from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import { ApiError } from "../middleware/errorHandler.js";
import { createAuditLog } from "./audit.service.js";

// ---------------------------------------------------------------------------
// Helpers — pure
// ---------------------------------------------------------------------------

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function resolveSubmissionSlug(title: string, submissionId: string): string {
  const base = slugify(title);
  const suffix = submissionId.slice(0, 8).toLowerCase();
  const slug = `${base}-${suffix}`;
  return slug.slice(0, 64);
}

function resolveSpeakerSlug(name: string, submissionId: string, idx: number): string {
  const base = slugify(name);
  const suffix = submissionId.slice(0, 4).toLowerCase();
  const slug = `${base}-${suffix}-${idx}`;
  return slug.slice(0, 64);
}

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
// Promotion — accept→draft speakers + draft sessions (§21)
// Idempotent, audited, transactional rollback on failure
// ---------------------------------------------------------------------------

export type PromoteResult = {
  session: typeof sessions.$inferSelect;
  speakers: Array<typeof speakers.$inferSelect>;
  alreadyPromoted: boolean;
};

export type PromoteOptions = {
  submissionId: string;
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export async function promoteSubmission(db: Db, opts: PromoteOptions): Promise<PromoteResult> {
  const { submissionId, actorId, ip, userAgent } = opts;

  const submission = await selectOne<typeof cfpSubmissions.$inferSelect>(
    db
      .select()
      .from(cfpSubmissions)
      .where(and(eq(cfpSubmissions.id, submissionId), isNull(cfpSubmissions.deletedAt)))
  );
  if (!submission) throw new ApiError(404, "NOT_FOUND", "CFP submission not found");

  if (submission.status !== "accepted") {
    throw new ApiError(
      409,
      "CONFLICT",
      `Only accepted submissions can be promoted (current: ${submission.status})`
    );
  }

  // Idempotency: check audit log for previous promotion
  const auditRows = (await selectAll(
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, submissionId), eq(auditLogs.action, "cfp.promote")))
  )) as Array<typeof auditLogs.$inferSelect>;

  if (auditRows.length > 0) {
    // Parse most recent metadata for IDs
    const latest = auditRows.sort((a, b) => (b.createdAt as number) - (a.createdAt as number))[0];
    try {
      const meta = latest.metadata ? JSON.parse(latest.metadata as string) : null;
      if (meta && meta.sessionId) {
        const sess = await selectOne<typeof sessions.$inferSelect>(
          db
            .select()
            .from(sessions)
            .where(eq(sessions.id, meta.sessionId as string))
        );
        const speakerIds: string[] = Array.isArray(meta.speakerIds)
          ? (meta.speakerIds as string[])
          : [];
        const speakerRows: Array<typeof speakers.$inferSelect> = [];
        for (const sid of speakerIds) {
          const sp = await selectOne<typeof speakers.$inferSelect>(
            db.select().from(speakers).where(eq(speakers.id, sid))
          );
          if (sp) speakerRows.push(sp);
        }
        if (sess && speakerRows.length > 0) {
          return { session: sess, speakers: speakerRows, alreadyPromoted: true };
        }
      }
    } catch {
      // ignore parse error — fall through to slug check
    }

    // Fallback slug check — if session with derived slug exists, treat as promoted
    const derivedSlug = resolveSubmissionSlug(submission.title as string, submissionId);
    const existingSession = await selectOne<typeof sessions.$inferSelect>(
      db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.eventId, submission.eventId as string),
            eq(sessions.slug, derivedSlug),
            isNull(sessions.deletedAt)
          )
        )
    );
    if (existingSession) {
      const linkRows = (await selectAll(
        db.select().from(sessionSpeakers).where(eq(sessionSpeakers.sessionId, existingSession.id))
      )) as Array<{ speakerId: string }>;
      const speakerRows: Array<typeof speakers.$inferSelect> = [];
      for (const link of linkRows) {
        const sp = await selectOne<typeof speakers.$inferSelect>(
          db.select().from(speakers).where(eq(speakers.id, link.speakerId))
        );
        if (sp) speakerRows.push(sp);
      }
      return { session: existingSession, speakers: speakerRows, alreadyPromoted: true };
    }
  }

  // Also check by slug directly even without audit (idempotent second call without audit race)
  const derivedSlug = resolveSubmissionSlug(submission.title as string, submissionId);
  const slugExists = await selectOne<typeof sessions.$inferSelect>(
    db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.eventId, submission.eventId as string),
          eq(sessions.slug, derivedSlug),
          isNull(sessions.deletedAt)
        )
      )
  );
  if (slugExists) {
    const linkRows = (await selectAll(
      db.select().from(sessionSpeakers).where(eq(sessionSpeakers.sessionId, slugExists.id))
    )) as Array<{ speakerId: string }>;
    const speakerRows: Array<typeof speakers.$inferSelect> = [];
    for (const link of linkRows) {
      const sp = await selectOne<typeof speakers.$inferSelect>(
        db.select().from(speakers).where(eq(speakers.id, link.speakerId))
      );
      if (sp) speakerRows.push(sp);
    }
    return { session: slugExists, speakers: speakerRows, alreadyPromoted: true };
  }

  // Need cfp speakers
  const cfpSpeakers = (await selectAll(
    db
      .select()
      .from(cfpSubmissionSpeakers)
      .where(eq(cfpSubmissionSpeakers.submissionId, submissionId))
  )) as Array<typeof cfpSubmissionSpeakers.$inferSelect>;

  if (cfpSpeakers.length === 0) {
    throw new ApiError(409, "CONFLICT", "Submission has no speakers — cannot promote");
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionId = crypto.randomUUID();
  const speakerIds: string[] = [];
  const speakerRowsToInsert: Array<Record<string, unknown>> = [];

  for (let i = 0; i < cfpSpeakers.length; i++) {
    const cs = cfpSpeakers[i];
    const spId = crypto.randomUUID();
    speakerIds.push(spId);
    const slug = resolveSpeakerSlug(cs.name as string, submissionId, i);
    // Ensure bio not empty — speakers.bio is NOT NULL
    const bio =
      (cs.bio as string | null) ??
      (submission.submitterBio as string | null) ??
      `Speaker for ${submission.title}`;
    const safeBio =
      bio.trim().length >= 20
        ? bio.trim()
        : `${bio.trim()} — promoted from CFP submission ${submissionId.slice(0, 8)}`;
    speakerRowsToInsert.push({
      id: spId,
      eventId: submission.eventId,
      slug,
      name: cs.name,
      role: cs.role ?? null,
      company: cs.company ?? null,
      bio: safeBio,
      photoUrl: null,
      photoKey: null,
      linkedin: null,
      twitter: null,
      isDraft: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  const sessionSlug = derivedSlug;
  const sessionLevel = (submission.level as string | null) ?? null;
  const sessionValues = {
    id: sessionId,
    eventId: submission.eventId,
    roomId: null,
    slug: sessionSlug,
    title: submission.title,
    type: "talk",
    level: sessionLevel,
    abstract: submission.abstract,
    startsAt: null,
    endsAt: null,
    startsAtEpoch: null,
    endsAtEpoch: null,
    isDraft: 1,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

  try {
    await withTransaction(db, async (tx) => {
      for (const row of speakerRowsToInsert) {
        await runQuery(tx.insert(speakers).values(row as never));
      }
      await runQuery(tx.insert(sessions).values(sessionValues as never));
      for (const spId of speakerIds) {
        await runQuery(
          tx.insert(sessionSpeakers).values({
            sessionId,
            speakerId: spId,
            createdAt: now,
          } as never)
        );
      }
      await createAuditLog(tx as Db, {
        actorId: actorId ?? null,
        action: "cfp.promote",
        targetType: "cfp_submission",
        targetId: submissionId,
        metadata: {
          sessionId,
          speakerIds,
          sessionSlug,
          eventId: submission.eventId,
        },
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
        now: now * 1000,
      });
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    if (/UNIQUE|constraint/i.test(msg)) {
      const existing = await selectOne<typeof sessions.$inferSelect>(
        db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.eventId, submission.eventId as string),
              eq(sessions.slug, sessionSlug),
              isNull(sessions.deletedAt)
            )
          )
      );
      if (existing) {
        const linkRows = (await selectAll(
          db.select().from(sessionSpeakers).where(eq(sessionSpeakers.sessionId, existing.id))
        )) as Array<{
          speakerId: string;
        }>;
        const spRows: Array<typeof speakers.$inferSelect> = [];
        for (const l of linkRows) {
          const sp = await selectOne<typeof speakers.$inferSelect>(
            db.select().from(speakers).where(eq(speakers.id, l.speakerId))
          );
          if (sp) spRows.push(sp);
        }
        return { session: existing, speakers: spRows, alreadyPromoted: true };
      }
    }
    throw new ApiError(500, "INTERNAL_ERROR", `Promotion failed: ${msg.slice(0, 200)}`);
  }

  const createdSession = await selectOne<typeof sessions.$inferSelect>(
    db.select().from(sessions).where(eq(sessions.id, sessionId))
  );
  if (!createdSession)
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch promoted session");

  const createdSpeakers: Array<typeof speakers.$inferSelect> = [];
  for (const sid of speakerIds) {
    const sp = await selectOne<typeof speakers.$inferSelect>(
      db.select().from(speakers).where(eq(speakers.id, sid))
    );
    if (sp) createdSpeakers.push(sp);
  }

  return { session: createdSession, speakers: createdSpeakers, alreadyPromoted: false };
}

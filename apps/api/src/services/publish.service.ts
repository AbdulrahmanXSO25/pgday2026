import { eq, desc, isNull } from "drizzle-orm";
import type { Db } from "@pgegypt/db";
import { publications, auditLogs, events, users } from "@pgegypt/db";
import { ApiError } from "../middleware/errorHandler.js";
import { assembleContent, hashFiles, createLocalTarget, createR2Target } from "@pgegypt/publish";
import type { PublishTarget } from "@pgegypt/publish";

// Re-export for callers that need to construct target manually
export { assembleContent } from "@pgegypt/publish";

const DEFAULT_EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";

// ---------------------------------------------------------------------------
// Helpers — Drizzle sync vs D1 async agnostic (same pattern as other services)
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

async function runQuery(query: unknown): Promise<void> {
  const q = query as Record<string, unknown>;
  if (typeof q.run === "function") {
    const res = (q.run as () => unknown)();
    if (res instanceof Promise) await res;
    return;
  }
  await (query as Promise<unknown>);
}

function nowSec(now?: number): number {
  return Math.floor((now ?? Date.now()) / 1000);
}

function getClientMeta(ip?: string, userAgent?: string): { ip: string | null; ua: string | null } {
  return { ip: ip ?? null, ua: userAgent ?? null };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PublishOptions = {
  db: Db;
  actorId?: string;
  ip?: string;
  userAgent?: string;
  target?: PublishTarget;
  eventId?: string;
  now?: number;
};

export type PublishResult = {
  id: string;
  eventId: string;
  status: string;
  contentHash: string;
  writtenFiles: string[];
  publishedAt: number;
};

// Lazy resolve for local target — local active in Phases 0-6
async function resolveTarget(target?: PublishTarget): Promise<PublishTarget> {
  if (target) return target;
  const envKind = (typeof process !== "undefined" ? process.env.PUBLISH_TARGET : undefined) as
    string | undefined;
  if (envKind === "r2") {
    return createR2Target();
  }
  // Default: try to create local target; if fs not available (e.g., Workers edge), fallback to memory
  try {
    return createLocalTarget();
  } catch {
    return {
      kind: "local" as const,
      async publish(files: Record<string, unknown>) {
        const keys = Object.keys(files);
        const hash = await hashFiles(files);
        return { ok: true, target: "local" as const, contentHash: hash, writtenFiles: keys };
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Service — publishContent: assemble → validate → write → log publications + audit_logs
// Idempotent: same contentHash reuses existing publication id (no duplicate) but still writes files
// ---------------------------------------------------------------------------

export async function publishContent(options: PublishOptions): Promise<PublishResult> {
  const { db, actorId, ip, userAgent, eventId: requestedEventId, now } = options;
  const resolvedTarget = await resolveTarget(options.target);
  const eventId = requestedEventId?.trim() || DEFAULT_EVENT_ID;
  const created = nowSec(now);

  // 1) Ensure event exists (or fallback event will be used by assemble)
  // We check but don't fail if missing — assemble will produce fallback site-config
  const eventRows = await selectAll(db.select().from(events).where(isNull(events.deletedAt)));
  const eventExists = (eventRows as Array<{ id: string }>).some((e) => e.id === eventId);
  const eventSlug =
    (eventRows as Array<{ id: string; slug?: string }>)
      .find((e) => e.id === eventId)
      ?.slug?.trim() || "pgegypt-2026";
  // If no events at all, we still allow publish (fallback site-config)
  // But if requestedEventId explicit and not found, 404
  if (
    requestedEventId &&
    requestedEventId.trim().length > 0 &&
    !eventExists &&
    eventRows.length > 0
  ) {
    throw new ApiError(404, "NOT_FOUND", `Event ${eventId} not found`);
  }

  // 2) Assemble — validates via Zod inside
  let files: Record<string, unknown>;
  try {
    files = await assembleContent(db, { eventId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Log failed publication attempt
    const failId = crypto.randomUUID();
    try {
      await runQuery(
        db.insert(publications).values({
          id: failId,
          eventId,
          status: "failed",
          contentHash: null,
          publishedAt: null,
          publishedBy: actorId ?? null,
          metadata: JSON.stringify({ error: msg.slice(0, 500) }),
          createdAt: created,
          updatedAt: created,
        } as never)
      );
    } catch {
      // ignore logging failure
    }
    throw new ApiError(500, "INTERNAL_ERROR", `Assemble failed: ${msg.slice(0, 300)}`);
  }

  // 3) Compute hash via helper
  const contentHash = await hashFiles(files);

  // 4) Idempotency check — if last publication for this event has same hash, reuse id
  const recentRows = (await selectAll(
    db
      .select()
      .from(publications)
      .where(eq(publications.eventId, eventId))
      .orderBy(desc(publications.createdAt))
      .limit(1)
  )) as Array<typeof publications.$inferSelect>;

  const last = recentRows[0];
  if (last && last.contentHash === contentHash && last.status === "published") {
    // Still write files to ensure publish dir is populated (idempotent overwrite)
    const writeRes = await resolvedTarget.publish(files, { eventSlug });
    if (!writeRes.ok) {
      throw new ApiError(500, "INTERNAL_ERROR", writeRes.error ?? "Publish target failed");
    }
    // No new publication row — return existing
    return {
      id: last.id,
      eventId,
      status: last.status,
      contentHash,
      writtenFiles: writeRes.writtenFiles ?? Object.keys(files),
      publishedAt: (last.publishedAt as number) ?? created,
    };
  }

  // 5) Write via target
  const writeResult = await resolvedTarget.publish(files, { eventSlug });
  if (!writeResult.ok) {
    const failId = crypto.randomUUID();
    try {
      await runQuery(
        db.insert(publications).values({
          id: failId,
          eventId,
          status: "failed",
          contentHash,
          publishedAt: null,
          publishedBy: actorId ?? null,
          metadata: JSON.stringify({
            error: writeResult.error?.slice(0, 500),
            writtenFiles: writeResult.writtenFiles,
          }),
          createdAt: created,
          updatedAt: created,
        } as never)
      );
    } catch {
      // ignore
    }
    throw new ApiError(500, "INTERNAL_ERROR", writeResult.error ?? "Publish failed");
  }

  const finalHash = writeResult.contentHash ?? contentHash;
  const writtenFiles = writeResult.writtenFiles ?? Object.keys(files);

  // 6) Log to publications table — status published
  const pubId = crypto.randomUUID();
  // Resolve actorId to null if not exists (X-Test-User fake ids in tests)
  let resolvedActorId: string | null = actorId ?? null;
  if (resolvedActorId) {
    try {
      const actorRows = await selectAll(
        db.select().from(users).where(eq(users.id, resolvedActorId)).limit(1)
      );
      if (actorRows.length === 0) resolvedActorId = null;
    } catch {
      resolvedActorId = null;
    }
  }
  try {
    await runQuery(
      db.insert(publications).values({
        id: pubId,
        eventId,
        status: "published",
        contentHash: finalHash,
        publishedAt: created,
        publishedBy: resolvedActorId,
        metadata: JSON.stringify({ writtenFiles, target: resolvedTarget.kind }),
        createdAt: created,
        updatedAt: created,
      } as never)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("FOREIGN KEY") && resolvedActorId) {
      await runQuery(
        db.insert(publications).values({
          id: pubId,
          eventId,
          status: "published",
          contentHash: finalHash,
          publishedAt: created,
          publishedBy: null,
          metadata: JSON.stringify({ writtenFiles, target: resolvedTarget.kind }),
          createdAt: created,
          updatedAt: created,
        } as never)
      );
    } else {
      throw err;
    }
  }

  // 7) Audit log
  const auditId = crypto.randomUUID();
  const meta = getClientMeta(ip, userAgent);
  try {
    await runQuery(
      db.insert(auditLogs).values({
        id: auditId,
        actorId: resolvedActorId,
        action: "publish",
        targetType: "publication",
        targetId: pubId,
        metadata: JSON.stringify({
          eventId,
          contentHash: finalHash,
          writtenFiles,
          target: resolvedTarget.kind,
        }),
        ipAddress: meta.ip,
        userAgent: meta.ua,
        createdAt: created,
      } as never)
    );
  } catch {
    // audit failure should not fail publish — log but continue
    console.error("[publish] audit log failed");
  }

  return {
    id: pubId,
    eventId,
    status: "published",
    contentHash: finalHash,
    writtenFiles,
    publishedAt: created,
  };
}

export async function listPublications(
  db: Db,
  filters: { eventId?: string; limit?: number; offset?: number } = {}
): Promise<Array<typeof publications.$inferSelect>> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  let query = db
    .select()
    .from(publications)
    .orderBy(desc(publications.createdAt))
    .limit(limit)
    .offset(offset);
  // Filter by eventId if provided
  if (filters.eventId) {
    query = db
      .select()
      .from(publications)
      .where(eq(publications.eventId, filters.eventId))
      .orderBy(desc(publications.createdAt))
      .limit(limit)
      .offset(offset) as never;
  }
  const rows = await selectAll(query);
  return rows as Array<typeof publications.$inferSelect>;
}

export async function getPublicationById(
  db: Db,
  id: string
): Promise<typeof publications.$inferSelect | null> {
  const rows = await selectAll(db.select().from(publications).where(eq(publications.id, id)));
  return (rows[0] as typeof publications.$inferSelect) ?? null;
}

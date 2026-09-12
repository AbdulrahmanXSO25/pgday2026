import { Hono } from "hono";
import { eq, and, isNull, desc, like, sql } from "drizzle-orm";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { getDb, requireDb } from "../lib/db.js";
import { ApiError } from "../middleware/errorHandler.js";
import { speakers, events } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import { SpeakerCreateSchema, SpeakerUpdateSchema } from "@pgegypt/validation";

// ---------------------------------------------------------------------------
// Helpers — handle better-sqlite3 sync vs D1 async
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
    return Array.isArray(awaited) ? await awaited : [];
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

function isUniqueViolation(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /UNIQUE|constraint/i.test(msg);
}

const DEFAULT_EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";

function resolveEventId(body: Record<string, unknown>): string {
  const maybe = (body.eventId ?? body.event_id) as string | undefined;
  if (typeof maybe === "string" && maybe.trim().length > 0) return maybe.trim();
  return DEFAULT_EVENT_ID;
}

async function ensureEvent(db: Db, eventId: string): Promise<void> {
  const row = await selectOne<{ id: string }>(
    db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
  );
  if (!row) throw new ApiError(404, "NOT_FOUND", `Event ${eventId} not found`);
}

// ---------------------------------------------------------------------------
// Route factories — pure composition
// ---------------------------------------------------------------------------

export function speakerRoutes() {
  const r = new Hono<AppEnv>();

  // List — READ
  const listHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const query = c.req.query() as Record<string, string>;
    const eventId = query.eventId ?? query.event_id ?? DEFAULT_EVENT_ID;
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const search = (query.search ?? query.q ?? "").trim().toLowerCase();
    const where = and(
      isNull(speakers.deletedAt),
      eq(speakers.eventId, eventId),
      ...(search ? [like(speakers.name, `%${search}%`)] : [])
    );
    const rows = (await selectAll(
      db
        .select()
        .from(speakers)
        .where(where)
        .orderBy(desc(speakers.createdAt))
        .limit(limit)
        .offset(offset)
    )) as Array<typeof speakers.$inferSelect>;
    const countRows = (await selectAll(
      db
        .select({ c: sql<number>`count(*)` })
        .from(speakers)
        .where(where)
    )) as Array<{ c: number }>;
    return c.json({
      success: true as const,
      data: rows,
      meta: { count: rows.length, total: Number(countRows[0]?.c ?? 0) },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // Get one — READ
  const getHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const id = c.req.param("id") as string;
    const row = await selectOne<typeof speakers.$inferSelect>(
      db
        .select()
        .from(speakers)
        .where(and(eq(speakers.id, id), isNull(speakers.deletedAt)))
    );
    if (!row) throw new ApiError(404, "NOT_FOUND", "Speaker not found");
    return c.json({
      success: true as const,
      data: row,
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // Create — WRITE
  const createHandler = async (c: import("hono").Context<AppEnv>) => {
    const body = c.req.valid("json" as never) as import("@pgegypt/validation").SpeakerCreatePayload;
    const db = requireDb(c);
    const eventId = resolveEventId(body as unknown as Record<string, unknown>);
    await ensureEvent(db, eventId);

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    try {
      await runQuery(
        db.insert(speakers).values({
          id,
          eventId,
          slug: body.slug,
          name: body.name,
          role: body.role ?? null,
          company: body.company ?? null,
          bio: body.bio,
          photoUrl: body.photoUrl ?? null,
          photoKey: body.photoKey ?? null,
          linkedin: body.linkedin ?? null,
          twitter: body.twitter ?? null,
          isDraft: body.isDraft ?? (body as { status?: number }).status ?? 0,
          createdAt: now,
          updatedAt: now,
        } as never)
      );
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ApiError(
          409,
          "CONFLICT",
          `Speaker slug "${body.slug}" already exists for this event`
        );
      throw error;
    }

    const created = await selectOne<typeof speakers.$inferSelect>(
      db.select().from(speakers).where(eq(speakers.id, id))
    );
    return c.json(
      {
        success: true as const,
        data: created,
        requestId: c.get("requestId" as never) as string | undefined,
      },
      201
    );
  };

  // Update — WRITE (PUT + PATCH share same logic, PATCH allows partial)
  const updateHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const body = c.req.valid("json" as never) as import("@pgegypt/validation").SpeakerUpdatePayload;
    const db = requireDb(c);
    const existing = await selectOne<typeof speakers.$inferSelect>(
      db
        .select()
        .from(speakers)
        .where(and(eq(speakers.id, id), isNull(speakers.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Speaker not found");

    // If slug changed, check unique
    if (body.slug && body.slug !== existing.slug) {
      const dup = await selectOne<{ id: string }>(
        db
          .select({ id: speakers.id })
          .from(speakers)
          .where(
            and(
              eq(speakers.eventId, existing.eventId),
              eq(speakers.slug, body.slug),
              isNull(speakers.deletedAt)
            )
          )
      );
      if (dup && dup.id !== id)
        throw new ApiError(
          409,
          "CONFLICT",
          `Speaker slug "${body.slug}" already exists for this event`
        );
    }

    const now = Math.floor(Date.now() / 1000);
    const updates: Record<string, unknown> = { updatedAt: now };
    if (body.slug !== undefined) updates.slug = body.slug;
    if (body.name !== undefined) updates.name = body.name;
    if (body.role !== undefined) updates.role = body.role ?? null;
    if (body.company !== undefined) updates.company = body.company ?? null;
    if (body.bio !== undefined) updates.bio = body.bio;
    if (body.photoUrl !== undefined) updates.photoUrl = body.photoUrl ?? null;
    if (body.photoKey !== undefined) updates.photoKey = body.photoKey ?? null;
    if (body.linkedin !== undefined) updates.linkedin = body.linkedin ?? null;
    if (body.twitter !== undefined) updates.twitter = body.twitter ?? null;
    if (body.isDraft !== undefined) updates.isDraft = body.isDraft;
    // §12.5 alias — status draft|published maps to isDraft
    if ((body as { status?: number }).status !== undefined)
      updates.isDraft = (body as { status?: number }).status;

    // Only update if there are changes beyond updatedAt
    if (Object.keys(updates).length > 1) {
      try {
        await runQuery(
          db
            .update(speakers)
            .set(updates as never)
            .where(eq(speakers.id, id))
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiError(409, "CONFLICT", `Speaker slug conflict`);
        throw error;
      }
    }

    const updated = await selectOne<typeof speakers.$inferSelect>(
      db.select().from(speakers).where(eq(speakers.id, id))
    );
    return c.json({
      success: true as const,
      data: updated,
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // Delete — WRITE (soft delete)
  const deleteHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const db = requireDb(c);
    const existing = await selectOne<typeof speakers.$inferSelect>(
      db
        .select()
        .from(speakers)
        .where(and(eq(speakers.id, id), isNull(speakers.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Speaker not found");
    const now = Math.floor(Date.now() / 1000);
    await runQuery(
      db
        .update(speakers)
        .set({ deletedAt: now, updatedAt: now } as never)
        .where(eq(speakers.id, id))
    );
    return c.json({
      success: true as const,
      data: { id },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // -----------------------------------------------------------------------
  // Mount — both /v1/admin/speakers and alias /v1/speakers for spec compat
  // All guarded by RBAC (WRITE→READ via hasPermission)
  // -----------------------------------------------------------------------

  // List
  r.get("/v1/admin/speakers", requireAuth(), requirePermission("speakers:READ"), listHandler);
  r.get("/v1/speakers", requireAuth(), requirePermission("speakers:READ"), listHandler);

  // Create
  r.post(
    "/v1/admin/speakers",
    requireAuth(),
    requirePermission("speakers:WRITE"),
    validateJson(SpeakerCreateSchema),
    createHandler
  );
  r.post(
    "/v1/speakers",
    requireAuth(),
    requirePermission("speakers:WRITE"),
    validateJson(SpeakerCreateSchema),
    createHandler
  );

  // Get one
  r.get("/v1/admin/speakers/:id", requireAuth(), requirePermission("speakers:READ"), getHandler);
  r.get("/v1/speakers/:id", requireAuth(), requirePermission("speakers:READ"), getHandler);

  // Update — PUT and PATCH
  r.put(
    "/v1/admin/speakers/:id",
    requireAuth(),
    requirePermission("speakers:WRITE"),
    validateJson(SpeakerUpdateSchema),
    updateHandler
  );
  r.put(
    "/v1/speakers/:id",
    requireAuth(),
    requirePermission("speakers:WRITE"),
    validateJson(SpeakerUpdateSchema),
    updateHandler
  );
  r.patch(
    "/v1/admin/speakers/:id",
    requireAuth(),
    requirePermission("speakers:WRITE"),
    validateJson(SpeakerUpdateSchema),
    updateHandler
  );
  r.patch(
    "/v1/speakers/:id",
    requireAuth(),
    requirePermission("speakers:WRITE"),
    validateJson(SpeakerUpdateSchema),
    updateHandler
  );

  // Delete
  r.delete(
    "/v1/admin/speakers/:id",
    requireAuth(),
    requirePermission("speakers:WRITE"),
    deleteHandler
  );
  r.delete("/v1/speakers/:id", requireAuth(), requirePermission("speakers:WRITE"), deleteHandler);

  return r;
}

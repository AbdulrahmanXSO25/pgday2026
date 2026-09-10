import { Hono } from "hono";
import { eq, and, isNull, desc, inArray } from "drizzle-orm";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { requireDb } from "../lib/db.js";
import { ApiError } from "../middleware/errorHandler.js";
import { sessions, sessionSpeakers, speakers, rooms, events } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import {
  SessionCreateSchema,
  SessionUpdateSchema,
  normalizeSessionTimes,
  normalizeSessionEventId,
  normalizeSessionRoomId,
  normalizeSpeakerIds,
} from "@pgegypt/validation";
import {
  assertNoScheduleConflict,
  assertNoSpeakerConflict,
  validateAndNormalizeTimes,
} from "../services/schedule-conflict.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// DB helpers — sync vs D1 async
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

async function ensureEvent(db: Db, eventId: string): Promise<void> {
  const row = await selectOne<{ id: string }>(
    db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
  );
  if (!row) throw new ApiError(404, "NOT_FOUND", `Event ${eventId} not found`);
}

async function ensureRoom(db: Db, roomId: string): Promise<void> {
  const row = await selectOne<{ id: string }>(
    db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.id, roomId), isNull(rooms.deletedAt)))
  );
  if (!row) throw new ApiError(404, "NOT_FOUND", `Room ${roomId} not found`);
}

async function ensureSpeakersExist(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = (await selectAll(
    db
      .select({ id: speakers.id })
      .from(speakers)
      .where(and(inArray(speakers.id, ids), isNull(speakers.deletedAt)))
  )) as Array<{ id: string }>;
  const found = new Set(rows.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ApiError(404, "NOT_FOUND", `Speaker(s) not found: ${missing.join(", ")}`);
  }
}

async function getSpeakerIdsForSession(db: Db, sessionId: string): Promise<string[]> {
  const rows = (await selectAll(
    db
      .select({ speakerId: sessionSpeakers.speakerId })
      .from(sessionSpeakers)
      .where(eq(sessionSpeakers.sessionId, sessionId))
  )) as Array<{ speakerId: string }>;
  return rows.map((r) => r.speakerId);
}

async function replaceSessionSpeakers(
  db: Db,
  sessionId: string,
  speakerIds: string[]
): Promise<void> {
  // Transactional replace — delete existing, insert new
  const maybeTx = (db as unknown as { transaction?: unknown }).transaction;
  const now = Math.floor(Date.now() / 1000);

  const doReplace = async (tx: Db) => {
    await runQuery(tx.delete(sessionSpeakers).where(eq(sessionSpeakers.sessionId, sessionId)));
    for (const sid of speakerIds) {
      await runQuery(
        tx.insert(sessionSpeakers).values({
          sessionId,
          speakerId: sid,
          createdAt: now,
        } as never)
      );
    }
  };

  if (typeof maybeTx === "function") {
    try {
      const txFn = maybeTx as (cb: (tx: Db) => Promise<void> | void) => Promise<void> | void;
      const res = txFn.call(db, async (tx: Db) => {
        await doReplace(tx);
      });
      if (res instanceof Promise) await res;
      return;
    } catch {
      // fallback to sequential
    }
  }

  // Sequential fallback
  await runQuery(db.delete(sessionSpeakers).where(eq(sessionSpeakers.sessionId, sessionId)));
  for (const sid of speakerIds) {
    await runQuery(
      db.insert(sessionSpeakers).values({
        sessionId,
        speakerId: sid,
        createdAt: now,
      } as never)
    );
  }
}

function enrichSessionWithSpeakers(
  session: typeof sessions.$inferSelect,
  speakerIds: string[]
): Record<string, unknown> {
  return { ...session, speakerIds };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function sessionRoutes() {
  const r = new Hono<AppEnv>();

  // List — READ, supports schedule ordering
  const listHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const query = c.req.query() as Record<string, string>;
    const eventId = query.eventId ?? query.event_id ?? DEFAULT_EVENT_ID;
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const where = and(isNull(sessions.deletedAt), eq(sessions.eventId, eventId));
    const rows = (await selectAll(
      db
        .select()
        .from(sessions)
        .where(where)
        .orderBy(desc(sessions.createdAt))
        .limit(limit)
        .offset(offset)
    )) as Array<typeof sessions.$inferSelect>;

    // Enrich with speakerIds for each session
    const enriched: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const sids = await getSpeakerIdsForSession(db, row.id);
      enriched.push(enrichSessionWithSpeakers(row, sids));
    }

    return c.json({
      success: true as const,
      data: enriched,
      meta: { count: enriched.length },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // Schedule aggregated view — same as list but ordered by startsAtEpoch
  const scheduleHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const query = c.req.query() as Record<string, string>;
    const eventId = query.eventId ?? query.event_id ?? DEFAULT_EVENT_ID;
    const rows = (await selectAll(
      db
        .select()
        .from(sessions)
        .where(and(isNull(sessions.deletedAt), eq(sessions.eventId, eventId)))
    )) as Array<typeof sessions.$inferSelect>;

    // Sort by epoch then createdAt
    rows.sort((a, b) => {
      const ae = (a.startsAtEpoch as number | null) ?? 0;
      const be = (b.startsAtEpoch as number | null) ?? 0;
      if (ae !== be) return ae - be;
      return (a.createdAt as number) - (b.createdAt as number);
    });

    const enriched: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const sids = await getSpeakerIdsForSession(db, row.id);
      enriched.push(enrichSessionWithSpeakers(row, sids));
    }

    return c.json({
      success: true as const,
      data: enriched,
      meta: { count: enriched.length },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  const getHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const id = c.req.param("id") as string;
    const row = await selectOne<typeof sessions.$inferSelect>(
      db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), isNull(sessions.deletedAt)))
    );
    if (!row) throw new ApiError(404, "NOT_FOUND", "Session not found");
    const sids = await getSpeakerIdsForSession(db, id);
    return c.json({
      success: true as const,
      data: enrichSessionWithSpeakers(row, sids),
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  const createHandler = async (c: import("hono").Context<AppEnv>) => {
    const body = c.req.valid("json" as never) as import("@pgegypt/validation").SessionCreatePayload;
    const db = requireDb(c);
    const eventId =
      normalizeSessionEventId(body as unknown as Record<string, unknown>) ?? DEFAULT_EVENT_ID;
    await ensureEvent(db, eventId);

    const roomId = normalizeSessionRoomId(body as unknown as Record<string, unknown>);
    if (roomId) await ensureRoom(db, roomId);

    const speakerIds = normalizeSpeakerIds(body as unknown as Record<string, string[]>) ?? [];
    if (speakerIds.length > 0) await ensureSpeakersExist(db, speakerIds);

    const times = normalizeSessionTimes(body as unknown as Record<string, unknown>);

    // Conflict check (§24) before insert
    if (roomId && times.startsAtEpoch && times.endsAtEpoch) {
      await assertNoScheduleConflict(db, {
        roomId,
        startsAtEpoch: times.startsAtEpoch,
        endsAtEpoch: times.endsAtEpoch,
      });
    }

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    const insertValues = {
      id,
      eventId,
      roomId: roomId ?? null,
      slug: body.slug,
      title: body.title,
      type: body.type ?? "talk",
      level: (body.level as string | null) ?? null,
      abstract: body.abstract ?? null,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      startsAtEpoch: times.startsAtEpoch,
      endsAtEpoch: times.endsAtEpoch,
      isDraft: body.isDraft ?? 0,
      status: (body.status as string | undefined) ?? "draft",
      createdAt: now,
      updatedAt: now,
    } as never;

    try {
      // Transactional insert session + speakers
      const maybeTx = (db as unknown as { transaction?: unknown }).transaction;
      if (typeof maybeTx === "function") {
        const txFn = maybeTx as (cb: (tx: Db) => Promise<void> | void) => Promise<void> | void;
        const res = txFn.call(db, async (tx: Db) => {
          await runQuery(tx.insert(sessions).values(insertValues));
          for (const sid of speakerIds) {
            await runQuery(
              tx.insert(sessionSpeakers).values({
                sessionId: id,
                speakerId: sid,
                createdAt: now,
              } as never)
            );
          }
        });
        if (res instanceof Promise) await res;
      } else {
        await runQuery(db.insert(sessions).values(insertValues));
        for (const sid of speakerIds) {
          await runQuery(
            db.insert(sessionSpeakers).values({
              sessionId: id,
              speakerId: sid,
              createdAt: now,
            } as never)
          );
        }
      }
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ApiError(
          409,
          "CONFLICT",
          `Session slug "${body.slug}" already exists for this event`
        );
      if (error instanceof ApiError) throw error;
      throw error;
    }

    const created = await selectOne<typeof sessions.$inferSelect>(
      db.select().from(sessions).where(eq(sessions.id, id))
    );
    const sids = await getSpeakerIdsForSession(db, id);
    return c.json(
      {
        success: true as const,
        data: enrichSessionWithSpeakers(created!, sids),
        requestId: c.get("requestId" as never) as string | undefined,
      },
      201
    );
  };

  const updateHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const body = c.req.valid("json" as never) as import("@pgegypt/validation").SessionUpdatePayload;
    const db = requireDb(c);
    const existing = await selectOne<typeof sessions.$inferSelect>(
      db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), isNull(sessions.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Session not found");

    if (body.slug && body.slug !== existing.slug) {
      const dup = await selectOne<{ id: string }>(
        db
          .select({ id: sessions.id })
          .from(sessions)
          .where(
            and(
              eq(sessions.eventId, existing.eventId),
              eq(sessions.slug, body.slug),
              isNull(sessions.deletedAt)
            )
          )
      );
      if (dup && dup.id !== id)
        throw new ApiError(409, "CONFLICT", `Session slug "${body.slug}" already exists`);
    }

    // Resolve roomId handling — explicit null means unset room
    let nextRoomId: string | null | undefined = undefined;
    if (body.roomId !== undefined || (body as Record<string, unknown>).room_id !== undefined) {
      const raw = normalizeSessionRoomId(body as unknown as Record<string, unknown>);
      nextRoomId = raw ?? null;
      if (nextRoomId) await ensureRoom(db, nextRoomId);
    } else {
      nextRoomId = (existing.roomId as string | null | undefined) ?? null;
    }
    // If body has roomId explicitly null via empty string, normalize returns undefined, but we treat as no change.
    // For explicit clearing, client should send roomId: null — but schema transforms null to undefined, so we treat undefined as no change.
    // To allow clearing, check if body had roomId key with null value before transform — simplified: if body.roomId === null or body.room_id === null, clear.
    const rawBody = c.req.valid("json" as never) as Record<string, unknown>;
    if (rawBody.roomId === null || rawBody.room_id === null) nextRoomId = null;

    const speakerIds = normalizeSpeakerIds(body as unknown as Record<string, string[]>);
    if (speakerIds !== undefined && speakerIds.length > 0)
      await ensureSpeakersExist(db, speakerIds);

    // Times — need to compute effective times for conflict check
    // If body provides times, use those; otherwise keep existing
    let effectiveTimes: {
      startsAt: string | null;
      endsAt: string | null;
      startsAtEpoch: number | null;
      endsAtEpoch: number | null;
    };
    const hasNewTimes =
      body.startsAt !== undefined ||
      (body as Record<string, unknown>).starts_at !== undefined ||
      body.endsAt !== undefined ||
      (body as Record<string, unknown>).ends_at !== undefined ||
      body.startsAtEpoch !== undefined ||
      body.endsAtEpoch !== undefined;

    if (hasNewTimes) {
      effectiveTimes = normalizeSessionTimes(body as unknown as Record<string, unknown>);
      // If body provided only one side but normalize returns nulls, it would have been validation error — but partial update should keep existing?
      // For patch, if only one of start/end is provided, validation already errored (both required). So we have either both or none.
      // If body provided times are null (clearing), set to null
      if (
        effectiveTimes.startsAtEpoch === null &&
        effectiveTimes.endsAtEpoch === null &&
        hasNewTimes
      ) {
        // Times were explicitly cleared (if client sent empty) — treat as null
        effectiveTimes = { startsAt: null, endsAt: null, startsAtEpoch: null, endsAtEpoch: null };
      }
    } else {
      effectiveTimes = {
        startsAt: existing.startsAt as string | null,
        endsAt: existing.endsAt as string | null,
        startsAtEpoch: existing.startsAtEpoch as number | null,
        endsAtEpoch: existing.endsAtEpoch as number | null,
      };
    }

    const effectiveRoomId =
      nextRoomId !== undefined ? nextRoomId : (existing.roomId as string | null);

    if (effectiveRoomId && effectiveTimes.startsAtEpoch && effectiveTimes.endsAtEpoch) {
      await assertNoScheduleConflict(db, {
        roomId: effectiveRoomId,
        startsAtEpoch: effectiveTimes.startsAtEpoch,
        endsAtEpoch: effectiveTimes.endsAtEpoch,
        excludeSessionId: id,
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const updates: Record<string, unknown> = { updatedAt: now };
    if (body.slug !== undefined) updates.slug = body.slug;
    if (body.title !== undefined) updates.title = body.title;
    if (body.type !== undefined) updates.type = body.type;
    if ((body.level as unknown) !== undefined) updates.level = (body.level as unknown) ?? null;
    if (body.abstract !== undefined) updates.abstract = body.abstract ?? null;
    if (nextRoomId !== undefined) updates.roomId = nextRoomId ?? null;
    if (hasNewTimes) {
      updates.startsAt = effectiveTimes.startsAt;
      updates.endsAt = effectiveTimes.endsAt;
      updates.startsAtEpoch = effectiveTimes.startsAtEpoch;
      updates.endsAtEpoch = effectiveTimes.endsAtEpoch;
    }
    if (body.isDraft !== undefined) updates.isDraft = body.isDraft;
    if (body.status !== undefined) updates.status = body.status;

    if (Object.keys(updates).length > 1) {
      try {
        await runQuery(
          db
            .update(sessions)
            .set(updates as never)
            .where(eq(sessions.id, id))
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiError(409, "CONFLICT", "Session slug conflict");
        throw error;
      }
    }

    if (speakerIds !== undefined) {
      await replaceSessionSpeakers(db, id, speakerIds);
    }

    const updated = await selectOne<typeof sessions.$inferSelect>(
      db.select().from(sessions).where(eq(sessions.id, id))
    );
    const sids = await getSpeakerIdsForSession(db, id);
    return c.json({
      success: true as const,
      data: enrichSessionWithSpeakers(updated!, sids),
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  const deleteHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const db = requireDb(c);
    const existing = await selectOne<typeof sessions.$inferSelect>(
      db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), isNull(sessions.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Session not found");
    const now = Math.floor(Date.now() / 1000);
    await runQuery(
      db
        .update(sessions)
        .set({ deletedAt: now, updatedAt: now } as never)
        .where(eq(sessions.id, id))
    );
    return c.json({
      success: true as const,
      data: { id },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // Mount — sessions CRUD + schedule
  const readPerm = "sessions:READ" as const;
  const writePerm = "sessions:WRITE" as const;

  r.get("/v1/admin/sessions", requireAuth(), requirePermission(readPerm), listHandler);
  r.get("/v1/sessions", requireAuth(), requirePermission(readPerm), listHandler);

  r.get("/v1/admin/schedule", requireAuth(), requirePermission(readPerm), scheduleHandler);
  r.get("/v1/schedule", requireAuth(), requirePermission(readPerm), scheduleHandler);

  r.post(
    "/v1/admin/sessions",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(SessionCreateSchema),
    createHandler
  );
  r.post(
    "/v1/sessions",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(SessionCreateSchema),
    createHandler
  );

  r.get("/v1/admin/sessions/:id", requireAuth(), requirePermission(readPerm), getHandler);
  r.get("/v1/sessions/:id", requireAuth(), requirePermission(readPerm), getHandler);

  r.put(
    "/v1/admin/sessions/:id",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(SessionUpdateSchema),
    updateHandler
  );
  r.put(
    "/v1/sessions/:id",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(SessionUpdateSchema),
    updateHandler
  );
  r.patch(
    "/v1/admin/sessions/:id",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(SessionUpdateSchema),
    updateHandler
  );
  r.patch(
    "/v1/sessions/:id",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(SessionUpdateSchema),
    updateHandler
  );

  r.delete("/v1/admin/sessions/:id", requireAuth(), requirePermission(writePerm), deleteHandler);
  r.delete("/v1/sessions/:id", requireAuth(), requirePermission(writePerm), deleteHandler);

  // §22.1 — PATCH /v1/admin/sessions/:id/speakers (SESSIONS WRITE) — set session_speakers
  const SetSpeakersSchema = z.object({
    speakerIds: z.array(z.string().min(1).max(128)).max(10),
    speaker_ids: z.array(z.string().min(1).max(128)).max(10).optional(),
  });
  const setSpeakersHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const db = requireDb(c);
    const body = c.req.valid("json" as never) as Record<string, unknown>;
    const existing = await selectOne<typeof sessions.$inferSelect>(
      db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), isNull(sessions.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Session not found");
    const raw = ((body.speakerIds ?? body.speaker_ids ?? []) as string[])
      .map((s) => s.trim())
      .filter(Boolean);
    await ensureSpeakersExist(db, raw);
    await replaceSessionSpeakers(db, id, raw);
    const sids = await getSpeakerIdsForSession(db, id);
    return c.json({
      success: true as const,
      data: enrichSessionWithSpeakers(existing, sids),
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };
  r.patch(
    "/v1/admin/sessions/:id/speakers",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(SetSpeakersSchema),
    setSpeakersHandler
  );
  r.patch(
    "/v1/sessions/:id/speakers",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(SetSpeakersSchema),
    setSpeakersHandler
  );

  // §21.3/§22.1 — PATCH /v1/admin/sessions/:id/status (SESSIONS WRITE) — draft ⇄ published gate
  const SetStatusSchema = z.object({
    status: z.enum(["draft", "published", "archived"]),
  });
  const setStatusHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const db = requireDb(c);
    const body = c.req.valid("json" as never) as { status: "draft" | "published" | "archived" };
    const existing = await selectOne<typeof sessions.$inferSelect>(
      db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), isNull(sessions.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Session not found");

    if (body.status === "published") {
      // §21.3 gate: all linked speakers must be published (isDraft=0)
      const sids = await getSpeakerIdsForSession(db, id);
      if (sids.length > 0) {
        const draftRows = (await selectAll(
          db
            .select({ id: speakers.id, name: speakers.name })
            .from(speakers)
            .where(
              and(inArray(speakers.id, sids), isNull(speakers.deletedAt), eq(speakers.isDraft, 1))
            )
        )) as Array<{ id: string; name: string }>;
        if (draftRows.length > 0) {
          throw new ApiError(
            422,
            "VALIDATION_ERROR",
            `Cannot publish session: linked speakers still draft: ${draftRows.map((s) => s.name).join(", ")}`
          );
        }
      }
    }
    const now = Math.floor(Date.now() / 1000);
    await runQuery(
      db
        .update(sessions)
        .set({
          status: body.status,
          isDraft: body.status === "published" ? 0 : 1,
          updatedAt: now,
        } as never)
        .where(eq(sessions.id, id))
    );
    const updated = await selectOne<typeof sessions.$inferSelect>(
      db.select().from(sessions).where(eq(sessions.id, id))
    );
    const sids = await getSpeakerIdsForSession(db, id);
    return c.json({
      success: true as const,
      data: enrichSessionWithSpeakers(updated!, sids),
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };
  r.patch(
    "/v1/admin/sessions/:id/status",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(SetStatusSchema),
    setStatusHandler
  );
  r.patch(
    "/v1/sessions/:id/status",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(SetStatusSchema),
    setStatusHandler
  );

  // §22.2 — PATCH /v1/admin/schedule/:id/slot (SCHEDULE WRITE) — room + time with conflict prevention
  const SlotSchema = z.object({
    roomId: z.string().min(1).max(128).optional().nullable(),
    room_id: z.string().min(1).max(128).optional().nullable(),
    startTime: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
      .optional()
      .nullable(),
    endTime: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
      .optional()
      .nullable(),
    startsAtEpoch: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
      .optional()
      .nullable(),
    endsAtEpoch: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
      .optional()
      .nullable(),
    startsAt: z.string().max(100).optional(),
    endsAt: z.string().max(100).optional(),
  });
  const slotHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const db = requireDb(c);
    const body = c.req.valid("json" as never) as Record<string, unknown>;
    const existing = await selectOne<typeof sessions.$inferSelect>(
      db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, id), isNull(sessions.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Session not found");

    const roomId = ((body.roomId ?? body.room_id ?? existing.roomId) as string | null) ?? null;
    if (roomId) await ensureRoom(db, roomId);

    const startTime = (body.startTime ??
      body.startsAtEpoch ??
      existing.startsAtEpoch ??
      undefined) as number | string | undefined;
    const endTime = (body.endTime ?? body.endsAtEpoch ?? existing.endsAtEpoch ?? undefined) as
      number | string | undefined;

    let times: {
      startsAt: string | null;
      endsAt: string | null;
      startsAtEpoch: number | null;
      endsAtEpoch: number | null;
    };
    if (body.startsAt || body.endsAt) {
      times = validateAndNormalizeTimes({
        startsAt: (body.startsAt as string) ?? (body.startTime ? String(body.startTime) : null),
        endsAt: (body.endsAt as string) ?? (body.endTime ? String(body.endTime) : null),
      });
    } else if (
      startTime !== undefined &&
      endTime !== undefined &&
      startTime !== null &&
      endTime !== null
    ) {
      const s = typeof startTime === "string" ? Number(startTime) : startTime;
      const e = typeof endTime === "string" ? Number(endTime) : endTime;
      times = validateAndNormalizeTimes({ startsAtEpoch: s, endsAtEpoch: e });
    } else {
      times = {
        startsAt: existing.startsAt as string | null,
        endsAt: existing.endsAt as string | null,
        startsAtEpoch: existing.startsAtEpoch as number | null,
        endsAtEpoch: existing.endsAtEpoch as number | null,
      };
    }

    // §22.2 conflict prevention — room + speaker overlap, inside same logical write
    if (roomId && times.startsAtEpoch && times.endsAtEpoch) {
      await assertNoScheduleConflict(db, {
        roomId,
        startsAtEpoch: times.startsAtEpoch,
        endsAtEpoch: times.endsAtEpoch,
        excludeSessionId: id,
      });
      await assertNoSpeakerConflict(db, {
        sessionId: id,
        startsAtEpoch: times.startsAtEpoch,
        endsAtEpoch: times.endsAtEpoch,
      });
    }

    const now = Math.floor(Date.now() / 1000);
    await runQuery(
      db
        .update(sessions)
        .set({
          roomId,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          startsAtEpoch: times.startsAtEpoch,
          endsAtEpoch: times.endsAtEpoch,
          updatedAt: now,
        } as never)
        .where(eq(sessions.id, id))
    );
    const updated = await selectOne<typeof sessions.$inferSelect>(
      db.select().from(sessions).where(eq(sessions.id, id))
    );
    const sids = await getSpeakerIdsForSession(db, id);
    return c.json({
      success: true as const,
      data: enrichSessionWithSpeakers(updated!, sids),
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };
  r.patch(
    "/v1/admin/schedule/:id/slot",
    requireAuth(),
    requirePermission("schedule:WRITE" as never),
    validateJson(SlotSchema),
    slotHandler
  );
  r.patch(
    "/v1/schedule/:id/slot",
    requireAuth(),
    requirePermission("schedule:WRITE" as never),
    validateJson(SlotSchema),
    slotHandler
  );

  return r;
}

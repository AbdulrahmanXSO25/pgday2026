import { Hono } from "hono";
import { eq, and, isNull, desc } from "drizzle-orm";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { requireDb } from "../lib/db.js";
import { ApiError } from "../middleware/errorHandler.js";
import { rooms, events } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import { RoomCreateSchema, RoomUpdateSchema } from "@pgegypt/validation";

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

export function roomRoutes() {
  const r = new Hono<AppEnv>();

  const listHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const query = c.req.query() as Record<string, string>;
    const eventId = query.eventId ?? query.event_id ?? DEFAULT_EVENT_ID;
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const where = and(isNull(rooms.deletedAt), eq(rooms.eventId, eventId));
    const rows = (await selectAll(
      db
        .select()
        .from(rooms)
        .where(where)
        .orderBy(desc(rooms.createdAt))
        .limit(limit)
        .offset(offset)
    )) as Array<typeof rooms.$inferSelect>;
    return c.json({
      success: true as const,
      data: rows,
      meta: { count: rows.length },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  const getHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const id = c.req.param("id") as string;
    const row = await selectOne<typeof rooms.$inferSelect>(
      db
        .select()
        .from(rooms)
        .where(and(eq(rooms.id, id), isNull(rooms.deletedAt)))
    );
    if (!row) throw new ApiError(404, "NOT_FOUND", "Room not found");
    return c.json({
      success: true as const,
      data: row,
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  const createHandler = async (c: import("hono").Context<AppEnv>) => {
    const body = c.req.valid("json" as never) as import("@pgegypt/validation").RoomCreatePayload;
    const db = requireDb(c);
    const eventId = resolveEventId(body as unknown as Record<string, unknown>);
    await ensureEvent(db, eventId);
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    try {
      await runQuery(
        db.insert(rooms).values({
          id,
          eventId,
          slug: body.slug,
          name: body.name,
          capacity: body.capacity ?? null,
          sortOrder: body.sortOrder ?? 0,
          createdAt: now,
          updatedAt: now,
        } as never)
      );
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ApiError(
          409,
          "CONFLICT",
          `Room slug or name "${body.slug}" already exists for this event`
        );
      throw error;
    }
    const created = await selectOne<typeof rooms.$inferSelect>(
      db.select().from(rooms).where(eq(rooms.id, id))
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

  const updateHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const body = c.req.valid("json" as never) as import("@pgegypt/validation").RoomUpdatePayload;
    const db = requireDb(c);
    const existing = await selectOne<typeof rooms.$inferSelect>(
      db
        .select()
        .from(rooms)
        .where(and(eq(rooms.id, id), isNull(rooms.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Room not found");

    if (body.slug && body.slug !== existing.slug) {
      const dup = await selectOne<{ id: string }>(
        db
          .select({ id: rooms.id })
          .from(rooms)
          .where(
            and(
              eq(rooms.eventId, existing.eventId),
              eq(rooms.slug, body.slug),
              isNull(rooms.deletedAt)
            )
          )
      );
      if (dup && dup.id !== id)
        throw new ApiError(409, "CONFLICT", `Room slug "${body.slug}" already exists`);
    }
    if (body.name && body.name !== existing.name) {
      const dup = await selectOne<{ id: string }>(
        db
          .select({ id: rooms.id })
          .from(rooms)
          .where(
            and(
              eq(rooms.eventId, existing.eventId),
              eq(rooms.name, body.name),
              isNull(rooms.deletedAt)
            )
          )
      );
      if (dup && dup.id !== id)
        throw new ApiError(409, "CONFLICT", `Room name "${body.name}" already exists`);
    }

    const now = Math.floor(Date.now() / 1000);
    const updates: Record<string, unknown> = { updatedAt: now };
    if (body.slug !== undefined) updates.slug = body.slug;
    if (body.name !== undefined) updates.name = body.name;
    if (body.capacity !== undefined) updates.capacity = body.capacity ?? null;
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

    if (Object.keys(updates).length > 1) {
      try {
        await runQuery(
          db
            .update(rooms)
            .set(updates as never)
            .where(eq(rooms.id, id))
        );
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ApiError(409, "CONFLICT", "Room slug/name conflict");
        throw error;
      }
    }

    const updated = await selectOne<typeof rooms.$inferSelect>(
      db.select().from(rooms).where(eq(rooms.id, id))
    );
    return c.json({
      success: true as const,
      data: updated,
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  const deleteHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const db = requireDb(c);
    const existing = await selectOne<typeof rooms.$inferSelect>(
      db
        .select()
        .from(rooms)
        .where(and(eq(rooms.id, id), isNull(rooms.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Room not found");
    const now = Math.floor(Date.now() / 1000);
    await runQuery(
      db
        .update(rooms)
        .set({ deletedAt: now, updatedAt: now } as never)
        .where(eq(rooms.id, id))
    );
    return c.json({
      success: true as const,
      data: { id },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // Rooms gated under sessions permission (or rooms if present) — sessions:READ/WRITE covers rooms FK-only per spec
  const readPerm = "sessions:READ" as const;
  const writePerm = "sessions:WRITE" as const;

  r.get("/v1/admin/rooms", requireAuth(), requirePermission(readPerm), listHandler);
  r.get("/v1/rooms", requireAuth(), requirePermission(readPerm), listHandler);

  r.post(
    "/v1/admin/rooms",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(RoomCreateSchema),
    createHandler
  );
  r.post(
    "/v1/rooms",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(RoomCreateSchema),
    createHandler
  );

  r.get("/v1/admin/rooms/:id", requireAuth(), requirePermission(readPerm), getHandler);
  r.get("/v1/rooms/:id", requireAuth(), requirePermission(readPerm), getHandler);

  r.put(
    "/v1/admin/rooms/:id",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(RoomUpdateSchema),
    updateHandler
  );
  r.put(
    "/v1/rooms/:id",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(RoomUpdateSchema),
    updateHandler
  );
  r.patch(
    "/v1/admin/rooms/:id",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(RoomUpdateSchema),
    updateHandler
  );
  r.patch(
    "/v1/rooms/:id",
    requireAuth(),
    requirePermission(writePerm),
    validateJson(RoomUpdateSchema),
    updateHandler
  );

  r.delete("/v1/admin/rooms/:id", requireAuth(), requirePermission(writePerm), deleteHandler);
  r.delete("/v1/rooms/:id", requireAuth(), requirePermission(writePerm), deleteHandler);

  return r;
}

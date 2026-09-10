import { Hono } from "hono";
import { eq, and, isNull, desc } from "drizzle-orm";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { requireDb } from "../lib/db.js";
import { ApiError } from "../middleware/errorHandler.js";
import { sponsors, events } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import { SponsorCreateSchema, SponsorUpdateSchema } from "@pgegypt/validation";

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

export function sponsorRoutes() {
  const r = new Hono<AppEnv>();

  const listHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const query = c.req.query() as Record<string, string>;
    const eventId = query.eventId ?? query.event_id ?? DEFAULT_EVENT_ID;
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const where = and(isNull(sponsors.deletedAt), eq(sponsors.eventId, eventId));
    const rows = (await selectAll(
      db
        .select()
        .from(sponsors)
        .where(where)
        .orderBy(desc(sponsors.createdAt))
        .limit(limit)
        .offset(offset)
    )) as Array<typeof sponsors.$inferSelect>;
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
    const row = await selectOne<typeof sponsors.$inferSelect>(
      db
        .select()
        .from(sponsors)
        .where(and(eq(sponsors.id, id), isNull(sponsors.deletedAt)))
    );
    if (!row) throw new ApiError(404, "NOT_FOUND", "Sponsor not found");
    return c.json({
      success: true as const,
      data: row,
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  const createHandler = async (c: import("hono").Context<AppEnv>) => {
    const body = c.req.valid("json" as never) as import("@pgegypt/validation").SponsorCreatePayload;
    const db = requireDb(c);
    const eventId = resolveEventId(body as unknown as Record<string, unknown>);
    await ensureEvent(db, eventId);
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    try {
      await runQuery(
        db.insert(sponsors).values({
          id,
          eventId,
          slug: body.slug,
          name: body.name,
          tier: body.tier,
          logoUrl: body.logoUrl ?? null,
          logoKey: body.logoKey ?? null,
          url: body.url,
          visible: body.visible ?? 1,
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
          `Sponsor slug "${body.slug}" already exists for this event`
        );
      throw error;
    }
    const created = await selectOne<typeof sponsors.$inferSelect>(
      db.select().from(sponsors).where(eq(sponsors.id, id))
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
    const body = c.req.valid("json" as never) as import("@pgegypt/validation").SponsorUpdatePayload;
    const db = requireDb(c);
    const existing = await selectOne<typeof sponsors.$inferSelect>(
      db
        .select()
        .from(sponsors)
        .where(and(eq(sponsors.id, id), isNull(sponsors.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Sponsor not found");

    if (body.slug && body.slug !== existing.slug) {
      const dup = await selectOne<{ id: string }>(
        db
          .select({ id: sponsors.id })
          .from(sponsors)
          .where(
            and(
              eq(sponsors.eventId, existing.eventId),
              eq(sponsors.slug, body.slug),
              isNull(sponsors.deletedAt)
            )
          )
      );
      if (dup && dup.id !== id)
        throw new ApiError(409, "CONFLICT", `Sponsor slug "${body.slug}" already exists`);
    }

    const now = Math.floor(Date.now() / 1000);
    const updates: Record<string, unknown> = { updatedAt: now };
    if (body.slug !== undefined) updates.slug = body.slug;
    if (body.name !== undefined) updates.name = body.name;
    if (body.tier !== undefined) updates.tier = body.tier;
    if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl ?? null;
    if (body.logoKey !== undefined) updates.logoKey = body.logoKey ?? null;
    if (body.url !== undefined) updates.url = body.url;
    if (body.visible !== undefined) updates.visible = body.visible;
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

    if (Object.keys(updates).length > 1) {
      try {
        await runQuery(
          db
            .update(sponsors)
            .set(updates as never)
            .where(eq(sponsors.id, id))
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiError(409, "CONFLICT", "Sponsor slug conflict");
        throw error;
      }
    }

    const updated = await selectOne<typeof sponsors.$inferSelect>(
      db.select().from(sponsors).where(eq(sponsors.id, id))
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
    const existing = await selectOne<typeof sponsors.$inferSelect>(
      db
        .select()
        .from(sponsors)
        .where(and(eq(sponsors.id, id), isNull(sponsors.deletedAt)))
    );
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Sponsor not found");
    const now = Math.floor(Date.now() / 1000);
    await runQuery(
      db
        .update(sponsors)
        .set({ deletedAt: now, updatedAt: now } as never)
        .where(eq(sponsors.id, id))
    );
    return c.json({
      success: true as const,
      data: { id },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // Mount both prefixes
  r.get("/v1/admin/sponsors", requireAuth(), requirePermission("sponsors:READ"), listHandler);
  r.get("/v1/sponsors", requireAuth(), requirePermission("sponsors:READ"), listHandler);

  r.post(
    "/v1/admin/sponsors",
    requireAuth(),
    requirePermission("sponsors:WRITE"),
    validateJson(SponsorCreateSchema),
    createHandler
  );
  r.post(
    "/v1/sponsors",
    requireAuth(),
    requirePermission("sponsors:WRITE"),
    validateJson(SponsorCreateSchema),
    createHandler
  );

  r.get("/v1/admin/sponsors/:id", requireAuth(), requirePermission("sponsors:READ"), getHandler);
  r.get("/v1/sponsors/:id", requireAuth(), requirePermission("sponsors:READ"), getHandler);

  r.put(
    "/v1/admin/sponsors/:id",
    requireAuth(),
    requirePermission("sponsors:WRITE"),
    validateJson(SponsorUpdateSchema),
    updateHandler
  );
  r.put(
    "/v1/sponsors/:id",
    requireAuth(),
    requirePermission("sponsors:WRITE"),
    validateJson(SponsorUpdateSchema),
    updateHandler
  );
  r.patch(
    "/v1/admin/sponsors/:id",
    requireAuth(),
    requirePermission("sponsors:WRITE"),
    validateJson(SponsorUpdateSchema),
    updateHandler
  );
  r.patch(
    "/v1/sponsors/:id",
    requireAuth(),
    requirePermission("sponsors:WRITE"),
    validateJson(SponsorUpdateSchema),
    updateHandler
  );

  r.delete(
    "/v1/admin/sponsors/:id",
    requireAuth(),
    requirePermission("sponsors:WRITE"),
    deleteHandler
  );
  r.delete("/v1/sponsors/:id", requireAuth(), requirePermission("sponsors:WRITE"), deleteHandler);

  return r;
}

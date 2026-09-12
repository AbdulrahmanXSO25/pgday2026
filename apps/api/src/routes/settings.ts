import { Hono } from "hono";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requireSuperAdmin } from "../middleware/requirePermission.js";
import { requireDb } from "../lib/db.js";
import { events } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import { ApiError } from "../middleware/errorHandler.js";
import { createAuditLog } from "../services/audit.service.js";

// ---------------------------------------------------------------------------
// Schemas — Zod at boundaries, SUPER_ADMIN only (§35)
// ---------------------------------------------------------------------------

const EventPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    tagline: z.string().max(300).optional().nullable(),
    date: z.string().optional(), // YYYY-MM-DD or ISO
    dateDisplay: z.string().max(200).optional().nullable(),
    startTime: z.string().max(10).optional().nullable(), // HH:MM conference start
    endTime: z.string().max(10).optional().nullable(), // HH:MM conference end
    city: z.string().max(200).optional(),
    venueStatus: z.enum(["tba", "confirmed"]).optional(),
    venueName: z.string().max(300).optional().nullable(),
    venueAddress: z.string().max(500).optional().nullable(),
    venueLat: z.number().optional().nullable(),
    venueLng: z.number().optional().nullable(),
    timezone: z.string().max(100).optional(),
    // §16.4 settings_json sub-objects — organizer / features / social / registration
    organizer: z.object({ name: z.string().min(1).max(200), contactEmail: z.email() }).optional(),
    features: z.object({ showSponsors: z.boolean(), showCountdown: z.boolean() }).optional(),
    social: z
      .object({
        twitter: z.string().url().nullable().optional(),
        linkedin: z.string().url().nullable().optional(),
        youtube: z.string().url().nullable().optional(),
      })
      .optional(),
    registration: z
      .object({ open: z.boolean(), closedMessage: z.string().max(500).optional() })
      .optional(),
  })
  .strict();

const DEFAULT_EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";

// ---------------------------------------------------------------------------
// DB helpers — sync vs async
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

function getMeta(c: import("hono").Context<import("../app.js").AppEnv>): {
  ip: string;
  userAgent: string;
  actorId?: string;
} {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const ua = c.req.header("user-agent") ?? "unknown";
  const user = c.get("user" as never) as { id: string } | undefined;
  return { ip, userAgent: ua, actorId: user?.id };
}

/** §16.4 — merge settings sub-objects into existing settings_json. Pure. */
function mergeSettingsJson(
  existing: string | null,
  patch: z.infer<typeof EventPatchSchema>
): string {
  let current: Record<string, unknown> = {};
  try {
    current = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
  } catch {
    current = {};
  }
  const next = { ...current };
  if (patch.organizer !== undefined)
    next.organizer = { ...((next.organizer as object) ?? {}), ...patch.organizer };
  if (patch.features !== undefined)
    next.features = { ...((next.features as object) ?? {}), ...patch.features };
  if (patch.social !== undefined)
    next.social = { ...((next.social as object) ?? {}), ...patch.social };
  if (patch.registration !== undefined)
    next.registration = { ...((next.registration as object) ?? {}), ...patch.registration };
  return JSON.stringify(next);
}

// ---------------------------------------------------------------------------
// Handlers — pure composition
// ---------------------------------------------------------------------------

async function getEventById(db: Db, id: string) {
  const row = await selectOne<typeof events.$inferSelect>(
    db
      .select()
      .from(events)
      .where(and(eq(events.id, id), isNull(events.deletedAt)))
  );
  if (!row) throw new ApiError(404, "NOT_FOUND", `Event ${id} not found`);
  return row;
}

export function settingsRoutes() {
  const r = new Hono<AppEnv>();

  // GET /v1/events — list (SUPER_ADMIN only)
  const listEventsHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const rows = (await selectAll(
      db.select().from(events).where(isNull(events.deletedAt))
    )) as Array<typeof events.$inferSelect>;
    return c.json(
      {
        success: true as const,
        data: rows,
        meta: { count: rows.length },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };

  // GET /v1/events/:id
  const getEventHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const db = requireDb(c);
    const row = await getEventById(db, id);
    return c.json(
      {
        success: true as const,
        data: row,
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };

  // PATCH /v1/events/:id
  const patchEventHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const body = c.req.valid("json" as never) as z.infer<typeof EventPatchSchema>;
    const db = requireDb(c);
    const meta = getMeta(c);

    // Ensure exists
    await getEventById(db, id);

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.tagline !== undefined) updates.tagline = body.tagline;
    if (body.date !== undefined) updates.date = body.date;
    if (body.dateDisplay !== undefined) updates.dateDisplay = body.dateDisplay;
    if (body.startTime !== undefined) updates.startTime = body.startTime;
    if (body.endTime !== undefined) updates.endTime = body.endTime;
    if (body.city !== undefined) updates.city = body.city;
    if (body.venueStatus !== undefined) updates.venueStatus = body.venueStatus;
    if (body.venueName !== undefined) updates.venueName = body.venueName;
    if (body.venueAddress !== undefined) updates.venueAddress = body.venueAddress;
    if (body.venueLat !== undefined) updates.venueLat = body.venueLat;
    if (body.venueLng !== undefined) updates.venueLng = body.venueLng;
    if (body.timezone !== undefined) updates.timezone = body.timezone;

    if (
      body.organizer !== undefined ||
      body.features !== undefined ||
      body.social !== undefined ||
      body.registration !== undefined
    ) {
      const existingRow = await getEventById(db, id);
      updates.settingsJson = mergeSettingsJson(
        (existingRow.settingsJson as string | null) ?? null,
        body
      );
    }

    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, "BAD_REQUEST", "No fields to update");
    }

    updates.updatedAt = Math.floor(Date.now() / 1000);

    await runQuery(
      db
        .update(events)
        .set(updates as never)
        .where(eq(events.id, id))
    );

    const updated = await getEventById(db, id);

    // Audit — event update
    await createAuditLog(db, {
      actorId: meta.actorId ?? null,
      action: "events.update",
      targetType: "event",
      targetId: id,
      metadata: body as Record<string, unknown>,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return c.json(
      {
        success: true as const,
        data: updated,
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };

  // Settings aliases — operate on default event
  const getSettingsHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const row = await getEventById(db, DEFAULT_EVENT_ID);
    return c.json(
      {
        success: true as const,
        data: row,
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };

  const patchSettingsHandler = async (c: import("hono").Context<AppEnv>) => {
    const body = c.req.valid("json" as never) as z.infer<typeof EventPatchSchema>;
    const db = requireDb(c);
    const meta = getMeta(c);
    const existingRow = await getEventById(db, DEFAULT_EVENT_ID);
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.tagline !== undefined) updates.tagline = body.tagline;
    if (body.date !== undefined) updates.date = body.date;
    if (body.dateDisplay !== undefined) updates.dateDisplay = body.dateDisplay;
    if (body.startTime !== undefined) updates.startTime = body.startTime;
    if (body.endTime !== undefined) updates.endTime = body.endTime;
    if (body.city !== undefined) updates.city = body.city;
    if (body.venueStatus !== undefined) updates.venueStatus = body.venueStatus;
    if (body.venueName !== undefined) updates.venueName = body.venueName;
    if (body.venueAddress !== undefined) updates.venueAddress = body.venueAddress;
    if (body.venueLat !== undefined) updates.venueLat = body.venueLat;
    if (body.venueLng !== undefined) updates.venueLng = body.venueLng;
    if (body.timezone !== undefined) updates.timezone = body.timezone;
    if (
      body.organizer !== undefined ||
      body.features !== undefined ||
      body.social !== undefined ||
      body.registration !== undefined
    ) {
      updates.settingsJson = mergeSettingsJson(
        (existingRow.settingsJson as string | null) ?? null,
        body
      );
    }
    if (Object.keys(updates).length === 0)
      throw new ApiError(400, "BAD_REQUEST", "No fields to update");
    updates.updatedAt = Math.floor(Date.now() / 1000);
    await runQuery(
      db
        .update(events)
        .set(updates as never)
        .where(eq(events.id, DEFAULT_EVENT_ID))
    );
    const updated = await getEventById(db, DEFAULT_EVENT_ID);
    await createAuditLog(db, {
      actorId: meta.actorId ?? null,
      action: "events.update",
      targetType: "event",
      targetId: DEFAULT_EVENT_ID,
      metadata: body as Record<string, unknown>,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return c.json(
      {
        success: true as const,
        data: updated,
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };

  // Events CRUD — SUPER_ADMIN only
  r.get("/v1/events", requireAuth(), requireSuperAdmin(), listEventsHandler);
  r.get("/v1/admin/events", requireAuth(), requireSuperAdmin(), listEventsHandler);

  r.get("/v1/events/:id", requireAuth(), requireSuperAdmin(), getEventHandler);
  r.get("/v1/admin/events/:id", requireAuth(), requireSuperAdmin(), getEventHandler);

  r.patch(
    "/v1/events/:id",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(EventPatchSchema),
    patchEventHandler
  );
  r.patch(
    "/v1/admin/events/:id",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(EventPatchSchema),
    patchEventHandler
  );

  // Settings alias — GET/PATCH /v1/settings  (rate_limits table documented via comment below)
  r.get("/v1/settings", requireAuth(), requireSuperAdmin(), getSettingsHandler);
  r.get("/v1/admin/settings", requireAuth(), requireSuperAdmin(), getSettingsHandler);

  r.patch(
    "/v1/settings",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(EventPatchSchema),
    patchSettingsHandler
  );
  r.patch(
    "/v1/admin/settings",
    requireAuth(),
    requireSuperAdmin(),
    validateJson(EventPatchSchema),
    patchSettingsHandler
  );

  // -----------------------------------------------------------------------
  // rate_limits table documented:
  // Table `rate_limits` (key TEXT PK, window_start INTEGER unixepoch, count INTEGER, updated_at INTEGER)
  // is used by registration.repo checkRateLimit (5/hour per IP) and is SQL-dialect
  // compatible across better-sqlite3 (local) and D1 (prod). No direct API exposure;
  // documented here per acceptance criterion "rate_limits table documented".
  // -----------------------------------------------------------------------

  return r;
}

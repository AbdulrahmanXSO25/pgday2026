import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { getDb } from "../lib/db.js";
import { ApiError } from "../middleware/errorHandler.js";
import { hasPermission, type Permission } from "@pgegypt/auth";
import { createR2Target, type R2BucketLike } from "@pgegypt/publish";
import type { AuthUser } from "../middleware/auth.js";
import * as publishService from "../services/publish.service.js";

function getClientMeta(c: { req: { header(n: string): string | undefined } }): {
  ip: string;
  userAgent: string;
} {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const ua = c.req.header("user-agent") ?? "unknown";
  return { ip, userAgent: ua };
}

function requirePublishWrite(): import("hono").MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next) => {
    const user = c.get("user" as never) as AuthUser | undefined;
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    // SUPER_ADMIN bypass
    if (user.role === "SUPER_ADMIN") {
      await next();
      return;
    }
    const needA: Permission = "publishing:WRITE" as Permission;
    const needB: Permission = "publish:WRITE" as Permission;
    const ok =
      hasPermission(user.role, user.permissions, needA) ||
      hasPermission(user.role, user.permissions, needB);
    if (!ok) throw new ApiError(403, "FORBIDDEN", "Missing permission publishing:WRITE");
    await next();
  };
}

function requirePublishRead(): import("hono").MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next) => {
    const user = c.get("user" as never) as AuthUser | undefined;
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    if (user.role === "SUPER_ADMIN") {
      await next();
      return;
    }
    const needA: Permission = "publishing:READ" as Permission;
    const needB: Permission = "publish:READ" as Permission;
    const ok =
      hasPermission(user.role, user.permissions, needA) ||
      hasPermission(user.role, user.permissions, needB);
    // Also allow WRITE implies READ
    const needWriteA: Permission = "publishing:WRITE" as Permission;
    const needWriteB: Permission = "publish:WRITE" as Permission;
    const okWrite =
      hasPermission(user.role, user.permissions, needWriteA) ||
      hasPermission(user.role, user.permissions, needWriteB);
    if (!ok && !okWrite) throw new ApiError(403, "FORBIDDEN", "Missing permission publishing:READ");
    await next();
  };
}

const PublishBodySchema = z.object({
  eventId: z.string().min(1).max(128).optional(),
  event_id: z.string().min(1).max(128).optional(),
});

function resolveEventId(body: z.infer<typeof PublishBodySchema> | undefined): string | undefined {
  if (!body) return undefined;
  const raw = (body.eventId ?? body.event_id) as string | undefined;
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return undefined;
}

export function publishRoutes() {
  const r = new Hono<AppEnv>();

  // POST /v1/publish — primary (§16) — SUPER_ADMIN | publishing:WRITE
  // Also aliases for legacy /v1/admin/publishing/publish and /v1/admin/publish
  const handlePublish = async (c: import("hono").Context<AppEnv>) => {
    const db = getDb(c as Context<AppEnv>);
    if (!db) throw new ApiError(500, "INTERNAL_ERROR", "DB not available");
    const user = c.get("user" as never) as AuthUser | undefined;
    const meta = getClientMeta(c as { req: { header(n: string): string | undefined } });
    let body: z.infer<typeof PublishBodySchema> | undefined;
    try {
      const raw = await c.req.json().catch(() => ({}));
      if (
        raw &&
        typeof raw === "object" &&
        Object.keys(raw as Record<string, unknown>).length > 0
      ) {
        const parsed = PublishBodySchema.safeParse(raw);
        if (!parsed.success) {
          throw new ApiError(422, "VALIDATION_ERROR", "Invalid publish body", {
            eventId: parsed.error.issues.map((i) => i.message),
          });
        }
        body = parsed.data;
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Empty body is okay — default event
      body = undefined;
    }
    const eventId = resolveEventId(body);
    // Production path: when the Worker has an R2_BUCKET binding, publish the
    // snapshot to R2 and trigger the site rebuild via GitHub dispatch.
    // Otherwise fall back to the local target (dev / tests).
    const env = (c.env ?? {}) as {
      R2_BUCKET?: R2BucketLike;
      GITHUB_REPO?: string;
      GITHUB_DISPATCH_TOKEN?: string;
    };
    const target = env.R2_BUCKET
      ? createR2Target({
          bucket: env.R2_BUCKET,
          repo: env.GITHUB_REPO,
          token: env.GITHUB_DISPATCH_TOKEN,
        })
      : undefined;
    const result = await publishService.publishContent({
      db,
      actorId: user?.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      eventId,
      ...(target ? { target } : {}),
    });
    return c.json(
      {
        success: true as const,
        data: result,
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };

  // Primary
  r.post("/v1/publish", requirePublishWrite(), handlePublish);
  // Aliases required by existing tests / legacy
  r.post("/v1/admin/publish", requirePublishWrite(), handlePublish);
  r.post("/v1/admin/publishing/publish", requirePublishWrite(), handlePublish);
  r.post("/v1/admin/publishing", requirePublishWrite(), handlePublish);

  // GET list — publishing:READ
  const handleList = async (c: import("hono").Context<AppEnv>) => {
    const db = getDb(c as Context<AppEnv>);
    if (!db) throw new ApiError(500, "INTERNAL_ERROR", "DB not available");
    const url = new URL(c.req.url);
    const eventId =
      url.searchParams.get("eventId") ?? url.searchParams.get("event_id") ?? undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset")
      ? Number(url.searchParams.get("offset"))
      : undefined;
    const rows = await publishService.listPublications(db, {
      eventId: eventId ?? undefined,
      limit,
      offset,
    });
    return c.json({
      success: true as const,
      data: rows,
      meta: { count: rows.length },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  r.get("/v1/publish", requirePublishRead(), handleList);
  r.get("/v1/admin/publishing", requirePublishRead(), handleList);
  r.get("/v1/admin/publish", requirePublishRead(), handleList);

  // GET by id
  const handleGetById = async (c: import("hono").Context<AppEnv>) => {
    const db = getDb(c as Context<AppEnv>);
    if (!db) throw new ApiError(500, "INTERNAL_ERROR", "DB not available");
    const id = c.req.param("id") as string;
    if (!id) throw new ApiError(400, "BAD_REQUEST", "id required");
    const row = await publishService.getPublicationById(db, id);
    if (!row) throw new ApiError(404, "NOT_FOUND", "Publication not found");
    return c.json({
      success: true as const,
      data: row,
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  r.get("/v1/publish/:id", requirePublishRead(), handleGetById);
  r.get("/v1/admin/publishing/:id", requirePublishRead(), handleGetById);
  r.get("/v1/admin/publish/:id", requirePublishRead(), handleGetById);

  return r;
}

// For backward compatibility, publishingRoutes re-exports publishRoutes
export function publishingRoutes() {
  return publishRoutes();
}

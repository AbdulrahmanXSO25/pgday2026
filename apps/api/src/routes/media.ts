import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { getDb, requireDb } from "../lib/db.js";
import { requireStorage } from "../lib/storage.js";
import { ApiError } from "../middleware/errorHandler.js";
import * as mediaService from "../services/media.service.js";
import { ALLOWED_MIME_TYPES } from "@pgegypt/storage";

// ---------------------------------------------------------------------------
// Zod schemas — at boundary
// ---------------------------------------------------------------------------

const PresignSchema = z
  .object({
    filename: z.string().min(1).max(200),
    mimeType: z.string().optional(),
    contentType: z.string().optional(),
    mime_type: z.string().optional(),
    content_type: z.string().optional(),
    size: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024)
      .optional()
      .or(z.string().transform((v) => Number(v)))
      .optional(),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024)
      .optional()
      .or(z.string().transform((v) => Number(v)))
      .optional(),
    size_bytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024)
      .optional()
      .or(z.string().transform((v) => Number(v)))
      .optional(),
    kind: z.string().optional(),
    eventId: z.string().optional(),
    event_id: z.string().optional(),
    prefix: z.string().optional(),
    bucket: z.string().optional(),
    originalName: z.string().optional(),
    original_name: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const mime = (
      data.mimeType ??
      data.contentType ??
      data.mime_type ??
      data.content_type ??
      ""
    ).trim();
    if (!mime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mimeType"],
        message: "mimeType is required",
      });
    } else if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mimeType"],
        message: `Unsupported mime type: ${mime}. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
      });
    }
    const filename = (data.filename ?? data.originalName ?? data.original_name ?? "").trim();
    if (!filename) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filename"],
        message: "filename is required",
      });
    }
    const sizeVal = data.size ?? data.sizeBytes ?? data.size_bytes;
    if (sizeVal === undefined || sizeVal === null || Number(sizeVal) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["size"],
        message: "size (or sizeBytes) is required and must be positive",
      });
    }
  });

const ConfirmSchema = z.object({
  id: z.string().min(1),
  storageKey: z.string().optional(),
  key: z.string().optional(),
  storage_key: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Handlers — pure composition, <50 lines
// ---------------------------------------------------------------------------

async function presignHandler(c: import("hono").Context<AppEnv>) {
  const body = c.req.valid("json" as never) as Record<string, unknown>;
  const db = requireDb(c);
  const storage = requireStorage(c);
  const user = c.get("user" as never) as { id: string } | undefined;

  // Normalize aliases
  const payload = {
    filename: (body.filename ?? body.originalName ?? body.original_name ?? "") as string,
    mimeType: (body.mimeType ??
      body.contentType ??
      body.mime_type ??
      body.content_type ??
      "") as string,
    size: Number(body.size ?? body.sizeBytes ?? body.size_bytes),
    kind: (body.kind as string | undefined) ?? "other",
    eventId: (body.eventId ?? body.event_id ?? undefined) as string | undefined,
    prefix: (body.prefix as string | undefined) ?? "media",
    bucket: body.bucket as string | undefined,
  };

  const result = await mediaService.createPresignedPut({
    db,
    storage,
    payload,
    uploaderId: user?.id,
  });

  return c.json(
    {
      success: true as const,
      data: {
        id: result.id,
        key: result.key,
        storageKey: result.storageKey,
        bucket: result.bucket,
        url: result.url,
        expiresAt: result.expiresAt,
        expiresIn: result.expiresIn,
        mimeType: result.mimeType,
        size: result.size,
        status: result.status,
      },
      requestId: c.get("requestId" as never) as string | undefined,
    },
    201
  );
}

async function confirmHandler(c: import("hono").Context<AppEnv>) {
  const body = c.req.valid("json" as never) as Record<string, unknown>;
  const db = requireDb(c);
  const storage = requireStorage(c);

  const payload = {
    id: (body.id ?? body.mediaId ?? "") as string,
    storageKey: (body.storageKey ?? body.key ?? body.storage_key ?? undefined) as
      string | undefined,
  };

  if (!payload.id) throw new ApiError(422, "VALIDATION_ERROR", "id is required");

  const result = await mediaService.confirmMedia({ db, storage, payload });
  return c.json({
    success: true as const,
    data: result,
    requestId: c.get("requestId" as never) as string | undefined,
  });
}

async function listHandler(c: import("hono").Context<AppEnv>) {
  const db = requireDb(c);
  const q = c.req.query() as Record<string, string>;
  const eventId = q.eventId ?? q.event_id ?? undefined;
  const limit = q.limit ? Number(q.limit) : undefined;
  const offset = q.offset ? Number(q.offset) : undefined;
  const status = q.status ?? undefined;
  const rows = await mediaService.listMedia(db, { eventId, limit, offset, status });
  // Do not leak internal storage paths to unauth? Already guarded by READ. Return safe fields.
  return c.json({
    success: true as const,
    data: rows,
    meta: { count: rows.length },
    requestId: c.get("requestId" as never) as string | undefined,
  });
}

async function getOneHandler(c: import("hono").Context<AppEnv>) {
  const db = requireDb(c);
  const id = c.req.param("id") as string;
  const row = await mediaService.getMediaById(db, id);
  if (!row) throw new ApiError(404, "NOT_FOUND", "Media not found");
  return c.json({
    success: true as const,
    data: row,
    requestId: c.get("requestId" as never) as string | undefined,
  });
}

async function deleteHandler(c: import("hono").Context<AppEnv>) {
  const db = requireDb(c);
  const storage = requireStorage(c);
  const id = c.req.param("id") as string;
  const result = await mediaService.deleteMedia(db, storage, id);
  return c.json({
    success: true as const,
    data: result,
    requestId: c.get("requestId" as never) as string | undefined,
  });
}

// ---------------------------------------------------------------------------
// Route factory — both /v1/media and /v1/admin/media aliases, RBAC guarded
// ---------------------------------------------------------------------------

export function mediaRoutes() {
  const r = new Hono<AppEnv>();

  // Presign — WRITE
  r.post(
    "/v1/media/presign",
    requireAuth(),
    requirePermission("media:WRITE"),
    validateJson(PresignSchema),
    presignHandler
  );
  r.post(
    "/v1/admin/media/presign",
    requireAuth(),
    requirePermission("media:WRITE"),
    validateJson(PresignSchema),
    presignHandler
  );

  // Confirm — WRITE
  r.post(
    "/v1/media/confirm",
    requireAuth(),
    requirePermission("media:WRITE"),
    validateJson(ConfirmSchema),
    confirmHandler
  );
  r.post(
    "/v1/admin/media/confirm",
    requireAuth(),
    requirePermission("media:WRITE"),
    validateJson(ConfirmSchema),
    confirmHandler
  );

  // List — READ
  r.get("/v1/media", requireAuth(), requirePermission("media:READ"), listHandler);
  r.get("/v1/admin/media", requireAuth(), requirePermission("media:READ"), listHandler);

  // Get one — READ
  r.get("/v1/media/:id", requireAuth(), requirePermission("media:READ"), getOneHandler);
  r.get("/v1/admin/media/:id", requireAuth(), requirePermission("media:READ"), getOneHandler);

  // Delete — WRITE
  r.delete("/v1/media/:id", requireAuth(), requirePermission("media:WRITE"), deleteHandler);
  r.delete("/v1/admin/media/:id", requireAuth(), requirePermission("media:WRITE"), deleteHandler);

  return r;
}

import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { media, events } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import type { StorageAdapter } from "@pgegypt/storage";
import { ApiError } from "../middleware/errorHandler.js";
import {
  ALLOWED_MIME_TYPES,
  MEDIA_KINDS,
  isMimeAllowedForKind,
  maxSizeForKind,
  readImageSize,
  DEFAULT_EVENT_ID,
  DEFAULT_BUCKET,
  buildStorageKey,
  sanitizeFilename,
} from "@pgegypt/storage";

// ---------------------------------------------------------------------------
// Helpers — pure, small, handle Drizzle sync vs async
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

function nowSec(now?: number): number {
  return Math.floor((now ?? Date.now()) / 1000);
}

function isUniqueViolation(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /UNIQUE|constraint/i.test(msg);
}

// ---------------------------------------------------------------------------
// Validation — pure
// ---------------------------------------------------------------------------

export type PresignPayload = {
  filename: string;
  mimeType?: string;
  contentType?: string;
  size: number;
  kind?: string;
  eventId?: string;
  event_id?: string;
  prefix?: string;
  bucket?: string;
};

export type ConfirmPayload = {
  id: string;
  storageKey?: string;
  key?: string;
};

export function resolveEventId(input: PresignPayload): string {
  const maybe = (input.eventId ?? input.event_id) as string | undefined;
  if (typeof maybe === "string" && maybe.trim().length > 0) return maybe.trim();
  return DEFAULT_EVENT_ID;
}

export function resolveMimeType(input: PresignPayload): string {
  const raw = (input.mimeType ?? input.contentType ?? "").trim().toLowerCase();
  return raw;
}

export function validatePresignPayload(payload: PresignPayload): {
  filename: string;
  mimeType: string;
  size: number;
  eventId: string;
  prefix: string;
  kind: string;
} {
  const filename = (payload.filename ?? "").trim();
  if (!filename) throw new ApiError(422, "VALIDATION_ERROR", "filename is required");
  const mimeType = resolveMimeType(payload);
  if (!mimeType) throw new ApiError(422, "VALIDATION_ERROR", "mimeType is required");

  // §17.4 — kind-aware MIME allowlist (images for photos/logos; +PDF for assets)
  const rawKind = (payload.kind ?? "other").trim();
  const kind = (MEDIA_KINDS as readonly string[]).includes(rawKind) ? rawKind : "other";
  if (!isMimeAllowedForKind(kind, mimeType)) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      `Unsupported mime type for ${kind}: ${mimeType}. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
      {
        mimeType: [
          `Unsupported mime type. Allowed for ${kind}: ${(kind === "asset" ? ALLOWED_MIME_TYPES : ALLOWED_MIME_TYPES.filter((m) => m !== "application/pdf")).join(", ")}`,
        ],
      }
    );
  }
  const size = Number(payload.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new ApiError(422, "VALIDATION_ERROR", "size must be a positive integer");
  }
  const maxSize = maxSizeForKind(kind, mimeType);
  if (size > maxSize) {
    throw new ApiError(422, "VALIDATION_ERROR", `File too large: ${size} exceeds max ${maxSize}`, {
      size: [`File too large. Max ${maxSize} bytes`],
    });
  }
  const eventId = resolveEventId(payload);
  const prefix = (payload.prefix ?? "media").trim() || "media";
  return { filename, mimeType, size, eventId, prefix, kind };
}

async function ensureEventExists(db: Db, eventId: string): Promise<void> {
  const row = await selectOne<{ id: string }>(
    db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), isNull(events.deletedAt)))
  );
  if (!row) throw new ApiError(404, "NOT_FOUND", `Event ${eventId} not found`);
}

// ---------------------------------------------------------------------------
// Service — DI, explicit errors, pure composition
// ---------------------------------------------------------------------------

export type CreatePresignOptions = {
  db: Db;
  storage: StorageAdapter;
  payload: PresignPayload;
  uploaderId?: string;
  now?: number;
};

export type CreatePresignResult = {
  id: string;
  key: string;
  storageKey: string;
  bucket: string;
  url: string;
  expiresAt: string;
  expiresIn: number;
  mimeType: string;
  size: number;
  kind: string;
  status: string;
};

/**
 * Create presigned PUT — validates, checks event, generates not-guessable key, presigns, inserts pending row.
 */
export async function createPresignedPut(
  options: CreatePresignOptions
): Promise<CreatePresignResult> {
  const { db, storage, payload, uploaderId, now } = options;
  const validated = validatePresignPayload(payload);
  await ensureEventExists(db, validated.eventId);

  const sanitized = sanitizeFilename(validated.filename);
  const key = buildStorageKey(validated.eventId, validated.filename, validated.prefix);
  const bucket = storage.bucket ?? payload.bucket ?? DEFAULT_BUCKET;

  let presigned: { url: string; key: string; bucket: string; expiresAt: string; expiresIn: number };
  try {
    presigned = await storage.presignPut(key, {
      contentType: validated.mimeType,
      contentLength: validated.size,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[media] presignPut failed:", msg.slice(0, 300));
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to create presigned URL");
  }

  const id = crypto.randomUUID();
  const created = nowSec(now);

  try {
    await runQuery(
      db.insert(media).values({
        id,
        eventId: validated.eventId,
        uploaderId: uploaderId ?? null,
        filename: sanitized,
        originalName: validated.filename,
        mimeType: validated.mimeType,
        size: validated.size,
        storageKey: key,
        bucket,
        kind: validated.kind,
        status: "pending",
        url: null,
        createdAt: created,
        updatedAt: created,
      } as never)
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Extremely rare — retry with new uuid
      const retryKey = buildStorageKey(
        validated.eventId,
        validated.filename,
        validated.prefix,
        crypto.randomUUID()
      );
      try {
        const retryPresigned = await storage.presignPut(retryKey, {
          contentType: validated.mimeType,
          contentLength: validated.size,
        });
        const retryId = crypto.randomUUID();
        await runQuery(
          db.insert(media).values({
            id: retryId,
            eventId: validated.eventId,
            uploaderId: uploaderId ?? null,
            filename: sanitized,
            originalName: validated.filename,
            mimeType: validated.mimeType,
            size: validated.size,
            storageKey: retryKey,
            bucket,
            kind: validated.kind,
            status: "pending",
            url: null,
            createdAt: created,
            updatedAt: created,
          } as never)
        );
        return {
          id: retryId,
          key: retryKey,
          storageKey: retryKey,
          bucket,
          url: retryPresigned.url,
          expiresAt: retryPresigned.expiresAt,
          expiresIn: retryPresigned.expiresIn,
          mimeType: validated.mimeType,
          size: validated.size,
          kind: validated.kind,
          status: "pending",
        };
      } catch (retryErr) {
        const m = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (retryErr instanceof ApiError) throw retryErr;
        console.error("[media] retry insert failed:", m.slice(0, 300));
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to create media record");
      }
    }
    const m = error instanceof Error ? error.message : String(error);
    console.error("[media] insert failed:", m.slice(0, 300));
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to create media record");
  }

  return {
    id,
    key,
    storageKey: key,
    bucket,
    url: presigned.url,
    expiresAt: presigned.expiresAt,
    expiresIn: presigned.expiresIn,
    mimeType: validated.mimeType,
    size: validated.size,
    kind: validated.kind,
    status: "pending",
  };
}

export type ConfirmOptions = {
  db: Db;
  storage: StorageAdapter;
  payload: ConfirmPayload;
  now?: number;
};

export type ConfirmResult = {
  id: string;
  storageKey: string;
  status: string;
  url: string | null;
  kind?: string | null;
  width?: number | null;
  height?: number | null;
};

/**
 * Confirm upload — verifies object exists in storage (MinIO :9000 or memory) then flips pending→ready.
 */
export async function confirmMedia(options: ConfirmOptions): Promise<ConfirmResult> {
  const { db, storage, payload, now } = options;
  const id = (payload.id ?? "").trim();
  if (!id) throw new ApiError(422, "VALIDATION_ERROR", "id is required");

  const row = await selectOne<typeof media.$inferSelect>(
    db.select().from(media).where(eq(media.id, id))
  );
  if (!row) throw new ApiError(404, "NOT_FOUND", "Media not found");
  if ((row.deletedAt as number | null) !== null)
    throw new ApiError(404, "NOT_FOUND", "Media not found");

  // If status already ready, idempotent success
  if (row.status === "ready") {
    return {
      id: row.id,
      storageKey: row.storageKey,
      status: row.status,
      url: row.url ?? storage.getPublicUrl(row.storageKey),
    };
  }
  if (row.status === "deleted") throw new ApiError(404, "NOT_FOUND", "Media deleted");

  const expectedKey = (payload.storageKey ?? payload.key ?? row.storageKey).trim();
  if (expectedKey !== row.storageKey) {
    throw new ApiError(400, "BAD_REQUEST", "storageKey mismatch");
  }

  let exists = false;
  let head: { exists: boolean; size?: number; contentType?: string } = { exists: false };
  try {
    head = await storage.headObject(expectedKey);
    exists = head.exists;
    if (!exists) {
      exists = await storage.exists(expectedKey);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[media] confirm exists check failed:", msg.slice(0, 300));
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to verify object in storage");
  }

  if (!exists) {
    throw new ApiError(404, "NOT_FOUND", "Object not found in storage — upload not completed");
  }

  // §17.4 — re-check the ACTUAL stored object against kind limits; delete + 422 on violation.
  const actualSize = head.size;
  const maxSize = maxSizeForKind(row.kind as string, row.mimeType as string);
  const actualMime = (head.contentType ?? row.mimeType ?? "").toLowerCase();
  const sizeViolation = typeof actualSize === "number" && actualSize > maxSize;
  const mimeViolation =
    actualMime.length > 0 && !isMimeAllowedForKind(row.kind as string, actualMime);
  if (sizeViolation || mimeViolation) {
    try {
      await storage.deleteObject(expectedKey);
    } catch {
      // best effort
    }
    await runQuery(
      db
        .update(media)
        .set({ status: "deleted", deletedAt: nowSec(now), updatedAt: nowSec(now) } as never)
        .where(eq(media.id, id))
    );
    const reason = sizeViolation
      ? `Uploaded file exceeds the ${maxSize} byte limit for ${row.kind}`
      : `Uploaded content type ${actualMime} is not allowed for ${row.kind}`;
    throw new ApiError(422, "VALIDATION_ERROR", reason);
  }

  // §17.3 — lightweight image dimension probe (PNG/JPEG/WebP) for explicit <Image> sizing
  let width: number | null = null;
  let height: number | null = null;
  if (typeof storage.getObject === "function" && actualMime.startsWith("image/")) {
    try {
      const bytes = await storage.getObject(expectedKey);
      const dims = readImageSize(bytes);
      if (dims) {
        width = dims.width;
        height = dims.height;
      }
    } catch (err) {
      // Dimension probe is best-effort — never fail confirm for it
      console.error(
        "[media] dimension probe failed (non-fatal):",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const publicUrl = storage.getPublicUrl(expectedKey);
  const updated = nowSec(now);

  try {
    await runQuery(
      db
        .update(media)
        .set({ status: "ready", url: publicUrl, width, height, updatedAt: updated } as never)
        .where(eq(media.id, id))
    );
  } catch (error) {
    const m = error instanceof Error ? error.message : String(error);
    console.error("[media] confirm update failed:", m.slice(0, 300));
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to confirm media");
  }

  const fresh = await selectOne<typeof media.$inferSelect>(
    db.select().from(media).where(eq(media.id, id))
  );
  return {
    id: fresh?.id ?? id,
    storageKey: fresh?.storageKey ?? expectedKey,
    status: fresh?.status ?? "ready",
    url: fresh?.url ?? publicUrl,
    kind: fresh?.kind ?? row.kind,
    width: fresh?.width ?? width,
    height: fresh?.height ?? height,
  };
}

export async function listMedia(
  db: Db,
  query: { eventId?: string; limit?: number; offset?: number; status?: string } = {}
): Promise<Array<typeof media.$inferSelect>> {
  const eventId = query.eventId?.trim() || undefined;
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const offset = Math.max(Number(query.offset) || 0, 0);

  let whereClause: unknown = isNull(media.deletedAt);
  if (eventId) {
    whereClause = and(whereClause as never, eq(media.eventId, eventId) as never);
  }
  if (query.status) {
    whereClause = and(whereClause as never, eq(media.status, query.status) as never);
  }

  const rows = (await selectAll(
    db
      .select()
      .from(media)
      .where(whereClause as never)
      .orderBy(desc(media.createdAt))
      .limit(limit)
      .offset(offset)
  )) as Array<typeof media.$inferSelect>;
  return rows;
}

export async function getMediaById(db: Db, id: string): Promise<typeof media.$inferSelect | null> {
  const row = await selectOne<typeof media.$inferSelect>(
    db
      .select()
      .from(media)
      .where(and(eq(media.id, id), isNull(media.deletedAt)))
  );
  return row;
}

export async function deleteMedia(
  db: Db,
  storage: StorageAdapter,
  id: string,
  now?: number
): Promise<{ id: string }> {
  const row = await selectOne<typeof media.$inferSelect>(
    db
      .select()
      .from(media)
      .where(and(eq(media.id, id), isNull(media.deletedAt)))
  );
  if (!row) throw new ApiError(404, "NOT_FOUND", "Media not found");

  const updated = nowSec(now);

  // Delete from storage (best effort — log but don't fail if not found)
  try {
    await storage.deleteObject(row.storageKey);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // NotFound is okay — already deleted
    if (!/not found|no such key|404/i.test(msg)) {
      console.error("[media] deleteObject failed:", msg.slice(0, 300));
    }
  }

  try {
    await runQuery(
      db
        .update(media)
        .set({ status: "deleted", deletedAt: updated, updatedAt: updated } as never)
        .where(eq(media.id, id))
    );
  } catch (error) {
    const m = error instanceof Error ? error.message : String(error);
    console.error("[media] delete update failed:", m.slice(0, 300));
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to delete media");
  }

  return { id };
}

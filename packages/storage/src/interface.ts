/**
 * Storage adapter interface — S3-compatible (MinIO local vs R2 prod).
 * No KV/DO/Images used (§17). Pure types + validation helpers.
 */

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PDF_MIME_TYPES = ["application/pdf"] as const;
export const ALLOWED_MIME_TYPES = [...IMAGE_MIME_TYPES, ...PDF_MIME_TYPES] as const;

export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

/** §17.4 — image limit 5 MB, PDF assets 10 MB */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_PDF_SIZE = 10 * 1024 * 1024;
/** Legacy generic cap (images) — kind-aware limits use maxSizeForKind(). */
export const MAX_FILE_SIZE = MAX_IMAGE_SIZE;
export const PRESIGN_EXPIRES_IN_SECONDS = 3600;
export const DEFAULT_BUCKET = "pgegypt-media";
export const DEFAULT_EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";

export type MediaKind = "speaker_photo" | "sponsor_logo" | "asset" | "other";
export const MEDIA_KINDS: readonly MediaKind[] = [
  "speaker_photo",
  "sponsor_logo",
  "asset",
  "other",
];

/** Allowed MIME types per §17.4 kind rules. */
export function allowedMimesForKind(kind: string | undefined): readonly string[] {
  if (kind === "asset") return ALLOWED_MIME_TYPES;
  return IMAGE_MIME_TYPES;
}

/** Size limit per §17.4 (images 5 MB, PDF assets 10 MB). */
export function maxSizeForKind(kind: string | undefined, mime?: string): number {
  if (kind === "asset" && mime === "application/pdf") return MAX_PDF_SIZE;
  return MAX_IMAGE_SIZE;
}

export function isMimeAllowedForKind(kind: string | undefined, mime: string): boolean {
  return allowedMimesForKind(kind).includes(mime.trim().toLowerCase());
}

export type StorageConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  forcePathStyle?: boolean;
  publicBaseUrl?: string;
};

export type PresignedPut = {
  url: string;
  key: string;
  bucket: string;
  expiresAt: string;
  expiresIn: number;
};

export type StorageHeadResult = {
  exists: boolean;
  size?: number;
  contentType?: string;
  etag?: string;
};

export interface StorageAdapter {
  readonly bucket: string;
  readonly endpoint: string;
  presignPut(
    key: string,
    options: { contentType: string; contentLength?: number; expiresIn?: number }
  ): Promise<PresignedPut>;
  exists(key: string): Promise<boolean>;
  headObject(key: string): Promise<StorageHeadResult>;
  deleteObject(key: string): Promise<void>;
  putObject(
    key: string,
    body: Uint8Array | Buffer | string,
    options?: { contentType?: string }
  ): Promise<void>;
  /** Optional: read object bytes (used for image dimension probes in media confirm). */
  getObject?(key: string): Promise<Uint8Array>;
  getPublicUrl(key: string): string;
}

// ---------------------------------------------------------------------------
// Pure helpers — no I/O, <50 lines each
// ---------------------------------------------------------------------------

/**
 * §17.3 — lightweight header-based image dimension probe (PNG / JPEG / WebP).
 * Pure: no I/O. Returns null when the format/size isn't parseable.
 */
export function readImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG — IHDR width/height at bytes 16..24
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // WebP — RIFF....WEBP
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const fourCC = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (fourCC === "VP8X" && bytes.length >= 30) {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width: w, height: h };
    }
    if (fourCC === "VP8 " && bytes.length >= 30) {
      const w = view.getUint16(26, true) & 0x3fff;
      const h = view.getUint16(28, true) & 0x3fff;
      return { width: w, height: h };
    }
    if (fourCC === "VP8L" && bytes.length >= 25) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }

  // JPEG — scan SOF markers
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      const size = view.getUint16(offset + 2, false);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return {
          height: view.getUint16(offset + 5, false),
          width: view.getUint16(offset + 7, false),
        };
      }
      offset += 2 + size;
    }
  }

  return null;
}

export function isAllowedMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(normalized);
}

export function validateMimeOrThrow(mime: string): void {
  if (!mime || typeof mime !== "string") throw new Error("mimeType is required");
  if (!isAllowedMime(mime)) {
    throw new Error(`Unsupported mime type: ${mime}. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`);
  }
}

export function validateSizeOrThrow(size: number): void {
  if (!Number.isFinite(size) || size <= 0) throw new Error("size must be a positive integer");
  if (size > MAX_FILE_SIZE)
    throw new Error(`File too large: ${size} bytes exceeds max ${MAX_FILE_SIZE} bytes`);
}

/**
 * Sanitize filename for storage key — strips path traversal, keeps safe chars.
 * Pure, deterministic.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== "string") return "file";
  // Strip directory components
  const base = filename.split("/").pop()?.split("\\").pop() ?? filename;
  // Keep alphanumeric, dash, underscore, dot; replace others with -
  let sanitized = base
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "");
  sanitized = sanitized.slice(0, 100);
  if (!sanitized || sanitized === "-" || sanitized === ".") return "file";
  // Prevent hidden files and ensure not empty after trimming dots/dashes
  sanitized = sanitized.replace(/^[-.]+/, "") || "file";
  return sanitized;
}

/**
 * Build storage key with event prefix and random suffix — not guessable.
 * Format: {eventId}/{prefix}/{uuid}-{sanitizedFilename}
 * Prefix allowlist prevents arbitrary path injection.
 */
export const ALLOWED_PREFIXES = ["media", "speakers", "sponsors", "avatars", "general"] as const;
export type AllowedPrefix = (typeof ALLOWED_PREFIXES)[number];

export function isAllowedPrefix(prefix: string): boolean {
  return (ALLOWED_PREFIXES as readonly string[]).includes(prefix);
}

export function buildStorageKey(
  eventId: string,
  filename: string,
  prefix: string = "media",
  uuid: string = crypto.randomUUID()
): string {
  const safeEvent = eventId.trim() || DEFAULT_EVENT_ID;
  // Prevent path traversal in eventId
  if (safeEvent.includes("..") || safeEvent.includes("/") || safeEvent.includes("\\")) {
    throw new Error("Invalid eventId");
  }
  const safePrefix = isAllowedPrefix(prefix) ? prefix : "media";
  const safeFilename = sanitizeFilename(filename);
  return `${safeEvent}/${safePrefix}/${uuid}-${safeFilename}`;
}

/**
 * Validate storage key shape — must be {eventId}/{prefix}/{uuid}-{name}
 * Prevents guessable enumeration by requiring UUID segment.
 */
export function isValidStorageKey(key: string): boolean {
  if (!key || typeof key !== "string") return false;
  if (key.includes("..") || key.includes("//")) return false;
  const parts = key.split("/");
  if (parts.length !== 3) return false;
  const [eventId, prefix, tail] = parts;
  if (!eventId || !prefix || !tail) return false;
  if (!isAllowedPrefix(prefix)) return false;
  // Tail must start with uuid-like segment
  const uuidPart = tail.split("-").slice(0, 5).join("-");
  // Simple uuid check: 8-4-4-4-12 hex
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  return uuidRe.test(tail.slice(0, 36));
}

/**
 * MinIO-local / memory storage adapter — for local dev and Vitest without real MinIO.
 * Implements same StorageAdapter interface as S3, but stores objects in-memory.
 * Presigned URL is fake but parsable; putObject simulates PUT; exists checks map.
 *
 * This satisfies "Don't require real MinIO container running for tests — mock S3 with in-memory map"
 * while keeping S3 SDK shape via s3-storage.ts for prod. Both adapters share interface.ts types.
 */

import type { StorageAdapter, PresignedPut } from "./interface.js";
import { DEFAULT_BUCKET, PRESIGN_EXPIRES_IN_SECONDS } from "./interface.js";

type MemoryObject = {
  key: string;
  contentType: string;
  size: number;
  body: Uint8Array;
  createdAt: number;
};

export type MinioLocalConfig = {
  endpoint?: string;
  bucket?: string;
  publicBaseUrl?: string;
};

export type MemoryStorageAdapter = StorageAdapter & {
  /** Test helper — simulate direct PUT to presigned URL */
  putObject(
    key: string,
    body: Uint8Array | Buffer | string,
    options?: { contentType?: string }
  ): Promise<void>;
  /** Test helper — clear all objects */
  clear(): void;
  /** Test helper — get internal map size */
  size(): number;
  /** Test helper — list keys */
  keys(): string[];
};

export function createMinioLocalStorage(config: MinioLocalConfig = {}): MemoryStorageAdapter {
  const endpoint = (config.endpoint ?? "http://localhost:9000").replace(/\/+$/, "");
  const bucket = config.bucket ?? DEFAULT_BUCKET;
  const publicBaseUrl = (config.publicBaseUrl ?? endpoint).replace(/\/+$/, "");
  const store = new Map<string, MemoryObject>();

  function toUint8Array(body: Uint8Array | Buffer | string): Uint8Array {
    if (typeof body === "string") return new TextEncoder().encode(body);
    if (body instanceof Uint8Array) return body;
    // Buffer is Uint8Array subclass in Node
    return new Uint8Array(body as Uint8Array);
  }

  const adapter: MemoryStorageAdapter = {
    bucket,
    endpoint,

    async presignPut(
      key: string,
      options: { contentType: string; contentLength?: number; expiresIn?: number }
    ): Promise<PresignedPut> {
      const expiresIn = options.expiresIn ?? PRESIGN_EXPIRES_IN_SECONDS;
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      // Fake presigned URL — points to local endpoint with query params for verification
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      const url = `${endpoint}/${bucket}/${encodedKey}?presigned=1&expires=${expiresIn}&contentType=${encodeURIComponent(options.contentType)}&t=${Date.now()}`;
      return { url, key, bucket, expiresAt, expiresIn };
    },

    async exists(key: string): Promise<boolean> {
      return store.has(key);
    },

    async headObject(
      key: string
    ): Promise<{ exists: boolean; size?: number; contentType?: string; etag?: string }> {
      const obj = store.get(key);
      if (!obj) return { exists: false };
      return {
        exists: true,
        size: obj.size,
        contentType: obj.contentType,
        etag: `"${obj.size}-${obj.createdAt}"`,
      };
    },

    async deleteObject(key: string): Promise<void> {
      store.delete(key);
    },

    async putObject(
      key: string,
      body: Uint8Array | Buffer | string,
      options?: { contentType?: string }
    ): Promise<void> {
      const bytes = toUint8Array(body);
      const ct = options?.contentType ?? "application/octet-stream";
      store.set(key, {
        key,
        contentType: ct,
        size: bytes.byteLength,
        body: bytes,
        createdAt: Date.now(),
      });
    },

    async getObject(key: string): Promise<Uint8Array> {
      const obj = store.get(key);
      if (!obj) throw new Error(`NotFound: ${key}`);
      return obj.body;
    },

    getPublicUrl(key: string): string {
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      return `${publicBaseUrl}/${bucket}/${encodedKey}`;
    },

    clear(): void {
      store.clear();
    },

    size(): number {
      return store.size;
    },

    keys(): string[] {
      return [...store.keys()];
    },
  };

  return adapter;
}

// Alias for convenience — matches spec deliverable naming
export const createMemoryStorage = createMinioLocalStorage;
export const createLocalStorage = createMinioLocalStorage;

// Default singleton for tests that import without explicit config
export function createDefaultMemoryStorage(): MemoryStorageAdapter {
  return createMinioLocalStorage({});
}

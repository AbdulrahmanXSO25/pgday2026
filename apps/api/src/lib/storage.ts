import type { Context, Next } from "hono";
import type { AppEnv } from "../app.js";
import type { StorageAdapter } from "@pgegypt/storage";
import { createMinioLocalStorage } from "@pgegypt/storage";

// Singleton memory storage for local dev/tests when no explicit storage injected
let defaultMemory: StorageAdapter | null = null;

function getDefaultStorage(): StorageAdapter {
  if (defaultMemory) return defaultMemory;
  defaultMemory = createMinioLocalStorage({
    endpoint: process.env.S3_ENDPOINT ?? process.env.MINIO_ENDPOINT ?? "http://localhost:9000",
    bucket: process.env.S3_BUCKET ?? "pgegypt-media",
  });
  return defaultMemory;
}

export function getStorage(c: Context<AppEnv>): StorageAdapter | undefined {
  try {
    const s = c.get("storage" as never) as StorageAdapter | undefined;
    if (s) return s;
  } catch {
    // ignore
  }
  return undefined;
}

export function requireStorage(c: Context<AppEnv>): StorageAdapter {
  const s = getStorage(c);
  if (s) return s;
  // Fallback to default memory — ensures routes work without explicit injection (tests, local)
  return getDefaultStorage();
}

export function storageMiddleware(storage: StorageAdapter | undefined) {
  return async (c: Context<AppEnv>, next: Next) => {
    if (storage) c.set("storage" as never, storage as never);
    await next();
  };
}

// Export for tests to reset singleton between runs
export function __resetDefaultStorage(): void {
  defaultMemory = null;
}

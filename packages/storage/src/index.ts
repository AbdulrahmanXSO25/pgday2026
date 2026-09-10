/**
 * @pgegypt/storage — barrel
 * Re-exports S3-compatible adapters (MinIO local vs R2 prod via S3 SDK v3).
 * No KV/DO/Images (§17).
 */

export * from "./interface.js";
export * from "./s3-storage.js";
export * from "./minio-local.js";

// Convenience factories — typed re-exports for DI in apps/api
export { createS3Storage, createR2StorageFromEnv } from "./s3-storage.js";
export {
  createMinioLocalStorage,
  createMemoryStorage,
  createLocalStorage,
  createDefaultMemoryStorage,
} from "./minio-local.js";

/**
 * S3-compatible storage adapter — production R2 + local MinIO via AWS SDK v3.
 * Lazy-loads @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner only when S3 storage is actually used.
 * Tests and local memory mode work without SDK installed.
 */

import type { StorageAdapter, StorageConfig, PresignedPut } from "./interface.js";
import { DEFAULT_BUCKET, PRESIGN_EXPIRES_IN_SECONDS } from "./interface.js";

export type S3StorageOptions = StorageConfig;

function resolveEndpoint(config: S3StorageOptions): string {
  const raw = config.endpoint?.trim() ?? "";
  if (!raw) return "http://localhost:9000";
  return raw.replace(/\/+$/, "");
}

function resolveBucket(config: S3StorageOptions): string {
  return config.bucket?.trim() || DEFAULT_BUCKET;
}

type S3ClientInstance = {
  send: (cmd: unknown) => Promise<unknown>;
};

type SdkModules = {
  S3Client: new (opts: unknown) => S3ClientInstance;
  PutObjectCommand: new (opts: unknown) => unknown;
  GetObjectCommand: new (opts: unknown) => unknown;
  HeadObjectCommand: new (opts: unknown) => unknown;
  DeleteObjectCommand: new (opts: unknown) => unknown;
  getSignedUrl: (client: unknown, cmd: unknown, opts: { expiresIn: number }) => Promise<string>;
};

let cachedSdk: SdkModules | null = null;
let sdkLoadError: Error | null = null;

async function loadSdk(): Promise<SdkModules> {
  if (cachedSdk) return cachedSdk;
  if (sdkLoadError) throw sdkLoadError;
  try {
    const s3Mod = (await import("@aws-sdk/client-s3")) as unknown as {
      S3Client: SdkModules["S3Client"];
      PutObjectCommand: SdkModules["PutObjectCommand"];
      GetObjectCommand: SdkModules["GetObjectCommand"];
      HeadObjectCommand: SdkModules["HeadObjectCommand"];
      DeleteObjectCommand: SdkModules["DeleteObjectCommand"];
    };
    const presignerMod = (await import("@aws-sdk/s3-request-presigner")) as unknown as {
      getSignedUrl: SdkModules["getSignedUrl"];
    };
    cachedSdk = {
      S3Client: s3Mod.S3Client,
      PutObjectCommand: s3Mod.PutObjectCommand,
      GetObjectCommand: s3Mod.GetObjectCommand,
      HeadObjectCommand: s3Mod.HeadObjectCommand,
      DeleteObjectCommand: s3Mod.DeleteObjectCommand,
      getSignedUrl: presignerMod.getSignedUrl,
    };
    return cachedSdk;
  } catch (err) {
    sdkLoadError = new Error(
      `S3 SDK not available — install @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner or use memory adapter: ${String((err as Error).message)}`
    );
    throw sdkLoadError;
  }
}

function createS3ClientSync(config: S3StorageOptions, sdk: SdkModules): S3ClientInstance {
  const endpoint = resolveEndpoint(config);
  return new sdk.S3Client({
    endpoint,
    region: config.region ?? "us-east-1",
    credentials: {
      accessKeyId: config.accessKeyId ?? "minioadmin",
      secretAccessKey: config.secretAccessKey ?? "minioadmin",
    },
    forcePathStyle: config.forcePathStyle ?? true,
  } as never);
}

export function createS3Storage(config: S3StorageOptions): StorageAdapter {
  const endpoint = resolveEndpoint(config);
  const bucket = resolveBucket(config);
  const publicBaseUrl = config.publicBaseUrl?.trim().replace(/\/+$/, "") ?? endpoint;

  let client: S3ClientInstance | null = null;
  let sdk: SdkModules | null = null;

  async function getClient(): Promise<S3ClientInstance> {
    if (client) return client;
    sdk = await loadSdk();
    client = createS3ClientSync({ ...config, endpoint, bucket }, sdk);
    return client;
  }

  // For sync access in tests that shouldn't be called before load, we throw helpfully
  function requireSdkSync(): SdkModules {
    if (sdk) return sdk;
    if (cachedSdk) {
      sdk = cachedSdk;
      return sdk;
    }
    throw new Error("S3 SDK not loaded — call await paths or use memory adapter");
  }

  return {
    bucket,
    endpoint,

    async presignPut(
      key: string,
      options: { contentType: string; contentLength?: number; expiresIn?: number }
    ): Promise<PresignedPut> {
      const c = await getClient();
      const s = requireSdkSync();
      const expiresIn = options.expiresIn ?? PRESIGN_EXPIRES_IN_SECONDS;
      const command = new s.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: options.contentType,
        ...(options.contentLength ? { ContentLength: options.contentLength } : {}),
      } as never);
      const url = await s.getSignedUrl(c as unknown, command as unknown, { expiresIn });
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      return { url, key, bucket, expiresAt, expiresIn };
    },

    async exists(key: string): Promise<boolean> {
      const r = await this.headObject(key);
      return r.exists;
    },

    async headObject(
      key: string
    ): Promise<{ exists: boolean; size?: number; contentType?: string; etag?: string }> {
      const c = await getClient();
      const s = requireSdkSync();
      try {
        const res = (await c.send(
          new s.HeadObjectCommand({ Bucket: bucket, Key: key } as never)
        )) as {
          ContentLength?: number;
          ContentType?: string;
          ETag?: string;
        };
        return {
          exists: true,
          size: res.ContentLength,
          contentType: res.ContentType,
          etag: res.ETag,
        };
      } catch (error) {
        const name = (error as { name?: string }).name ?? "";
        const msg = error instanceof Error ? error.message : String(error);
        if (name === "NotFound" || name === "NoSuchKey" || /not found|no such key|404/i.test(msg)) {
          return { exists: false };
        }
        throw error;
      }
    },

    async deleteObject(key: string): Promise<void> {
      const c = await getClient();
      const s = requireSdkSync();
      await c.send(new s.DeleteObjectCommand({ Bucket: bucket, Key: key } as never));
    },

    async putObject(
      key: string,
      body: Uint8Array | Buffer | string,
      options?: { contentType?: string }
    ): Promise<void> {
      const c = await getClient();
      const s = requireSdkSync();
      await c.send(
        new s.PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body as never,
          ...(options?.contentType ? { ContentType: options.contentType } : {}),
        } as never)
      );
    },

    async getObject(key: string): Promise<Uint8Array> {
      const c = await getClient();
      const s = requireSdkSync();
      const res = (await c.send(new s.GetObjectCommand({ Bucket: bucket, Key: key } as never))) as {
        Body?: { transformToByteArray?: () => Promise<Uint8Array> };
      };
      if (!res.Body?.transformToByteArray) throw new Error(`GetObject returned no body for ${key}`);
      return res.Body.transformToByteArray();
    },

    getPublicUrl(key: string): string {
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      return `${publicBaseUrl}/${bucket}/${encodedKey}`;
    },
  };
}

export function createR2StorageFromEnv(env: Record<string, string | undefined>): StorageAdapter {
  const endpoint = env.S3_ENDPOINT ?? env.R2_ENDPOINT ?? "http://localhost:9000";
  const bucket = env.S3_BUCKET ?? env.R2_BUCKET ?? DEFAULT_BUCKET;
  return createS3Storage({
    endpoint,
    bucket,
    accessKeyId: env.S3_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID ?? "minioadmin",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? env.R2_SECRET_ACCESS_KEY ?? "minioadmin",
    region: env.S3_REGION ?? env.R2_REGION ?? "us-east-1",
    forcePathStyle: true,
    publicBaseUrl: env.S3_PUBLIC_BASE_URL ?? env.R2_PUBLIC_BASE_URL ?? endpoint,
  });
}

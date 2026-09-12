/**
 * R2 hybrid storage adapter — production Workers (§17).
 *
 * Two mechanisms, per Cloudflare constraints:
 * - Native R2 binding (`R2_BUCKET`) for in-Worker object ops:
 *   put / head / delete / get. No credentials needed, no S3 API calls.
 * - S3-compatible API via aws4fetch for PRESIGNED URLs only — R2 bindings
 *   cannot presign. Requires R2 API token secrets (account id + access key).
 *
 * Never pass the binding object into anything expecting string env vars —
 * that mismatch took the API down in prod (bucket.trim is not a function).
 */

import type { StorageAdapter, StorageHeadResult, PresignedPut } from "./interface.js";
import { DEFAULT_BUCKET, PRESIGN_EXPIRES_IN_SECONDS } from "./interface.js";

// ---------------------------------------------------------------------------
// Native binding ops
// ---------------------------------------------------------------------------

/** Structural subset of the R2Bucket binding we use (keeps package free of @cloudflare/workers-types). */
export type R2BucketLike = {
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  head(
    key: string
  ): Promise<{ size?: number; httpMetadata?: { contentType?: string }; etag?: string } | null>;
  delete(key: string): Promise<void>;
  get(
    key: string
  ): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
};

export type R2BindingOptions = {
  bucketName?: string;
  publicBaseUrl?: string;
};

export function createR2BindingStorage(
  binding: R2BucketLike,
  options: R2BindingOptions = {}
): StorageAdapter {
  const bucket = options.bucketName?.trim() || DEFAULT_BUCKET;
  const publicBaseUrl = options.publicBaseUrl?.trim().replace(/\/+$/, "") ?? "";

  return {
    bucket,
    endpoint: "r2-binding",

    async presignPut(): Promise<PresignedPut> {
      throw new Error(
        "R2 binding cannot presign — use createHybridR2Storage with R2 API credentials (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)"
      );
    },

    async exists(key: string): Promise<boolean> {
      const head = await binding.head(key);
      return head !== null;
    },

    async headObject(key: string): Promise<StorageHeadResult> {
      const head = await binding.head(key);
      if (!head) return { exists: false };
      return {
        exists: true,
        size: head.size,
        contentType: head.httpMetadata?.contentType,
        etag: head.etag,
      };
    },

    async deleteObject(key: string): Promise<void> {
      await binding.delete(key);
    },

    async putObject(
      key: string,
      body: Uint8Array | Buffer | string,
      options?: { contentType?: string }
    ): Promise<void> {
      const value =
        typeof body === "string"
          ? body
          : body instanceof Uint8Array
            ? (body as Uint8Array).buffer.slice(
                (body as Uint8Array).byteOffset,
                (body as Uint8Array).byteOffset + (body as Uint8Array).byteLength
              )
            : (body as ArrayBuffer);
      await binding.put(key, value as ArrayBuffer, {
        ...(options?.contentType ? { httpMetadata: { contentType: options.contentType } } : {}),
      });
    },

    async getObject(key: string): Promise<Uint8Array> {
      const obj = await binding.get(key);
      if (!obj) throw new Error(`Object not found: ${key}`);
      const buf = await obj.arrayBuffer();
      return new Uint8Array(buf);
    },

    getPublicUrl(key: string): string {
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      return publicBaseUrl ? `${publicBaseUrl}/${encodedKey}` : encodedKey;
    },
  };
}

// ---------------------------------------------------------------------------
// Presign via S3-compatible API (aws4fetch — Workers-native, no node shims)
// ---------------------------------------------------------------------------

export type R2PresignConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName?: string;
};

export type R2PresignClient = {
  presignPut(
    key: string,
    options: { contentType: string; contentLength?: number; expiresIn?: number }
  ): Promise<PresignedPut>;
};

export function createR2PresignClient(config: R2PresignConfig): R2PresignClient {
  const bucket = config.bucketName?.trim() || DEFAULT_BUCKET;
  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;

  // Lazy-load aws4fetch — keeps local/tests free of the dependency when unused
  let awsClientPromise: Promise<{
    sign: (req: Request, opts?: unknown) => Promise<Request>;
  }> | null = null;
  function getAwsClient() {
    if (!awsClientPromise) {
      awsClientPromise = import("aws4fetch").then((mod) => {
        const AwsClient = (mod as unknown as { AwsClient: new (opts: unknown) => unknown })
          .AwsClient;
        return new AwsClient({
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          service: "s3",
          region: "auto",
        }) as unknown as { sign: (req: Request, opts?: unknown) => Promise<Request> };
      });
    }
    return awsClientPromise;
  }

  return {
    async presignPut(
      key: string,
      options: { contentType: string; contentLength?: number; expiresIn?: number }
    ): Promise<PresignedPut> {
      const expiresIn = options.expiresIn ?? PRESIGN_EXPIRES_IN_SECONDS;
      const url = new URL(
        `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`
      );
      const client = await getAwsClient();
      const signed = await client.sign(
        new Request(url, {
          method: "PUT",
          headers: {
            "content-type": options.contentType,
            ...(options.contentLength ? { "content-length": String(options.contentLength) } : {}),
          },
        }),
        { aws: { signQuery: true } }
      );
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      return { url: signed.url, key, bucket, expiresAt, expiresIn };
    },
  };
}

// ---------------------------------------------------------------------------
// Hybrid — binding ops + presign client
// ---------------------------------------------------------------------------

export type HybridR2Options = R2BindingOptions & {
  presign?: R2PresignConfig | null;
};

export function createHybridR2Storage(
  binding: R2BucketLike,
  options: HybridR2Options = {}
): StorageAdapter {
  const base = createR2BindingStorage(binding, options);
  const presignClient = options.presign ? createR2PresignClient(options.presign) : null;

  return {
    ...base,
    async presignPut(
      key: string,
      opts: { contentType: string; contentLength?: number; expiresIn?: number }
    ): Promise<PresignedPut> {
      if (!presignClient) {
        throw new Error(
          "R2 presign not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY secrets"
        );
      }
      return presignClient.presignPut(key, opts);
    },
  };
}

/**
 * Build the production storage adapter from Worker env.
 * - binding: env.R2_BUCKET (native R2 binding)
 * - presign: env.R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME
 * - publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL (API media proxy route)
 */
export function createR2StorageFromWorkerEnv(env: Record<string, unknown>): StorageAdapter {
  const binding = env.R2_BUCKET as R2BucketLike | undefined;
  if (!binding || typeof binding.put !== "function") {
    throw new Error("R2_BUCKET binding missing — cannot build production storage");
  }
  const accountId = (env.R2_ACCOUNT_ID as string | undefined)?.trim();
  const accessKeyId = (env.R2_ACCESS_KEY_ID as string | undefined)?.trim();
  const secretAccessKey = (env.R2_SECRET_ACCESS_KEY as string | undefined)?.trim();
  const presign =
    accountId && accessKeyId && secretAccessKey
      ? {
          accountId,
          accessKeyId,
          secretAccessKey,
          bucketName: (env.R2_BUCKET_NAME as string | undefined) ?? DEFAULT_BUCKET,
        }
      : null;
  return createHybridR2Storage(binding, {
    bucketName: (env.R2_BUCKET_NAME as string | undefined) ?? DEFAULT_BUCKET,
    publicBaseUrl: (env.MEDIA_PUBLIC_BASE_URL as string | undefined) ?? "",
    presign,
  });
}

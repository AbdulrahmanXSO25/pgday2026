/**
 * @pgegypt/storage tests — R2 hybrid adapter (binding ops + aws4fetch presign).
 * Pure unit tests with a fake binding; no network I/O.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createR2BindingStorage,
  createR2PresignClient,
  createHybridR2Storage,
  createR2StorageFromWorkerEnv,
} from "../src/r2-binding.js";

function fakeBinding() {
  const store = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    store,
    binding: {
      put: vi.fn(
        async (
          key: string,
          value: ArrayBuffer,
          opts?: { httpMetadata?: { contentType?: string } }
        ) => {
          store.set(key, {
            body: new Uint8Array(value),
            contentType: opts?.httpMetadata?.contentType,
          });
        }
      ),
      head: vi.fn(async (key: string) => {
        const v = store.get(key);
        return v
          ? {
              size: v.body.byteLength,
              httpMetadata: { contentType: v.contentType ?? "application/octet-stream" },
              etag: "etag-1",
            }
          : null;
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      get: vi.fn(async (key: string) => {
        const v = store.get(key);
        return v
          ? {
              arrayBuffer: async () =>
                v.body.buffer.slice(
                  v.body.byteOffset,
                  v.body.byteOffset + v.body.byteLength
                ) as ArrayBuffer,
              httpMetadata: { contentType: v.contentType ?? "application/octet-stream" },
            }
          : null;
      }),
    },
  };
}

describe("createR2BindingStorage (§17)", () => {
  it("put/head/get/delete round-trip through the binding", async () => {
    const { binding, store } = fakeBinding();
    const storage = createR2BindingStorage(binding as never, { bucketName: "pgegypt-media" });
    expect(storage.bucket).toBe("pgegypt-media");

    await storage.putObject("evt_1/media/abc-1.png", new Uint8Array([1, 2, 3]), {
      contentType: "image/png",
    });
    expect(store.has("evt_1/media/abc-1.png")).toBe(true);

    expect(await storage.exists("evt_1/media/abc-1.png")).toBe(true);
    expect(await storage.exists("missing")).toBe(false);

    const head = await storage.headObject("evt_1/media/abc-1.png");
    expect(head.exists).toBe(true);
    expect(head.size).toBe(3);
    expect(head.contentType).toBe("image/png");

    const bytes = await storage.getObject("evt_1/media/abc-1.png");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);

    await storage.deleteObject("evt_1/media/abc-1.png");
    expect(await storage.exists("evt_1/media/abc-1.png")).toBe(false);
  });

  it("presignPut throws a clear error on the bare binding", async () => {
    const { binding } = fakeBinding();
    const storage = createR2BindingStorage(binding as never);
    await expect(storage.presignPut("k", { contentType: "image/png" })).rejects.toThrow(
      /cannot presign/i
    );
  });

  it("getPublicUrl uses publicBaseUrl when provided", () => {
    const { binding } = fakeBinding();
    const storage = createR2BindingStorage(binding as never, {
      publicBaseUrl: "https://api.example.com/v1/media/file",
    });
    expect(storage.getPublicUrl("evt_1/media/abc-1.png")).toBe(
      "https://api.example.com/v1/media/file/evt_1/media/abc-1.png"
    );
  });
});

describe("createR2PresignClient (§17)", () => {
  it("presignPut signs a PUT request with query auth", async () => {
    const client = createR2PresignClient({
      accountId: "acct-123",
      accessKeyId: "key",
      secretAccessKey: "secret",
      bucketName: "pgegypt-media",
    });
    // Mock aws4fetch module
    const signMock = vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      url.searchParams.set("X-Amz-Signature", "signed");
      return new Request(url.toString(), { method: req.method });
    });
    vi.doMock("aws4fetch", () => ({
      AwsClient: class {
        sign = signMock;
      },
    }));

    const res = await client.presignPut("evt_1/media/abc.png", {
      contentType: "image/png",
      contentLength: 100,
      expiresIn: 900,
    });
    expect(res.url).toContain(
      "https://acct-123.r2.cloudflarestorage.com/pgegypt-media/evt_1/media/abc.png"
    );
    expect(res.url).toContain("X-Amz-Signature=signed");
    expect(res.key).toBe("evt_1/media/abc.png");
    expect(res.expiresIn).toBe(900);
    expect(res.expiresAt).toBeTruthy();
  });
});

describe("createHybridR2Storage / createR2StorageFromWorkerEnv (§17)", () => {
  it("hybrid: binding ops + presign from credentials", async () => {
    const { binding } = fakeBinding();
    const storage = createHybridR2Storage(binding as never, {
      bucketName: "pgegypt-media",
      presign: { accountId: "acct", accessKeyId: "k", secretAccessKey: "s" },
    });
    await storage.putObject("k", "hello", { contentType: "text/plain" });
    expect(await storage.exists("k")).toBe(true);
    // presign path exists (aws4fetch mocked in other test; here just verify it doesn't throw synchronously)
    expect(typeof storage.presignPut).toBe("function");
  });

  it("createR2StorageFromWorkerEnv throws when binding missing", () => {
    expect(() => createR2StorageFromWorkerEnv({})).toThrow(/R2_BUCKET binding missing/);
  });

  it("createR2StorageFromWorkerEnv builds hybrid from env shape", async () => {
    const { binding } = fakeBinding();
    const storage = createR2StorageFromWorkerEnv({
      R2_BUCKET: binding,
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET_NAME: "pgegypt-media",
      MEDIA_PUBLIC_BASE_URL: "https://api.example.com/v1/media/file",
    });
    await storage.putObject("evt_1/media/x.png", new Uint8Array([9]), { contentType: "image/png" });
    expect(await storage.exists("evt_1/media/x.png")).toBe(true);
    expect(storage.getPublicUrl("evt_1/media/x.png")).toBe(
      "https://api.example.com/v1/media/file/evt_1/media/x.png"
    );
  });

  it("presign degrades with a clear error when credentials missing", async () => {
    const { binding } = fakeBinding();
    const storage = createR2StorageFromWorkerEnv({ R2_BUCKET: binding });
    await expect(storage.presignPut("k", { contentType: "image/png" })).rejects.toThrow(
      /R2 presign not configured/
    );
  });
});

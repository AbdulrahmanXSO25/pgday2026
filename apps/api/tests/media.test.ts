/**
 * media.test.ts — Media presigned PUT + confirm (§17)
 * Covers: storage adapter interface (memory vs S3 SDK v3 shape),
 * POST /v1/media/presign WRITE mime allowlist + max size pending row,
 * POST /v1/media/confirm exists check flips ready,
 * GET READ, DELETE WRITE, paths not guessable, no public leak,
 * presign→PUT→confirm flow against mocked S3 (in-memory).
 *
 * Uses Hono app.request against real better-sqlite3 temp DB + MemoryStorage (no MinIO container needed).
 * S3 SDK v3 is imported for prod shape via @pgegypt/storage/s3-storage (not used in this test flow).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@pgegypt/db";
import { createApp } from "../src/app.js";
import { createMinioLocalStorage, ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from "@pgegypt/storage";
import type { StorageAdapter } from "@pgegypt/storage";

let sqlite: InstanceType<typeof Database>;
let db: BetterSQLite3Database<typeof schema>;
let tempDir: string;
let storage: StorageAdapter & {
  putObject(k: string, b: Uint8Array | string, o?: { contentType?: string }): Promise<void>;
  clear(): void;
};

const EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";

// ---------------------------------------------------------------------------
// Migration helpers — same as auth-rbac.test.ts
// ---------------------------------------------------------------------------

function getMigrationsDir(): string {
  const candidates = [
    resolve(process.cwd(), "migrations"),
    resolve(process.cwd(), "../../migrations"),
    resolve(process.cwd(), "./migrations"),
    join(resolve(new URL(".", import.meta.url).pathname), "../../../migrations"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return resolve(process.cwd(), "../../migrations");
}

function applyMigrations(database: InstanceType<typeof Database>, dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  database.exec("PRAGMA foreign_keys = OFF;");
  for (const f of files) {
    const raw = readFileSync(join(dir, f), "utf-8");
    const stripped = raw.replace(/--.*$/gm, "");
    const statements = stripped.split(";");
    for (const chunk of statements) {
      const stmt = chunk.trim();
      if (!stmt) continue;
      try {
        database.exec(stmt + ";");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("has no column named") ||
          msg.includes("no such column:") ||
          msg.includes("no such table:") ||
          msg.includes("UNIQUE constraint failed")
        ) {
          continue;
        }
        throw err;
      }
    }
  }
  database.exec("PRAGMA foreign_keys = ON;");
}

function cleanTables(): void {
  sqlite.prepare("DELETE FROM media").run();
  sqlite.prepare("DELETE FROM user_sessions").run();
  sqlite.prepare("DELETE FROM audit_logs").run();
  sqlite.prepare("DELETE FROM admin_permissions").run();
  sqlite.prepare("DELETE FROM users").run();
  sqlite.prepare("DELETE FROM registrations").run();
  sqlite.prepare("DELETE FROM rate_limits").run();
}

function testUserHeader(role: string, permissions: string[]): string {
  return JSON.stringify({
    id: `u_${role}`,
    email: `${role.toLowerCase()}@pgegypt.test`,
    role,
    permissions,
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "pgegypt-media-test-"));
  const dbFile = join(tempDir, "test.db");
  sqlite = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const dir = getMigrationsDir();
  applyMigrations(sqlite, dir);
  db = drizzle(sqlite, { schema });
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO events (id, slug, name, date, city) VALUES (?, 'pgegypt-2026','PG Day Egypt 2026','2026-10-10','Cairo, Egypt')"
    )
    .run(EVENT_ID);
  storage = createMinioLocalStorage({
    endpoint: "http://localhost:9000",
    bucket: "pgegypt-media",
  }) as never;
});

afterAll(() => {
  try {
    sqlite.close();
  } catch {}
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

beforeEach(() => {
  cleanTables();
  try {
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO events (id, slug, name, date, city) VALUES (?, 'pgegypt-2026','PG Day Egypt 2026','2026-10-10','Cairo, Egypt')"
      )
      .run(EVENT_ID);
  } catch {}
  (storage as unknown as { clear: () => void }).clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Storage adapter interface — MinIO local (memory) vs S3 SDK v3 prod shape", () => {
  it("memory adapter implements StorageAdapter with presignPut, exists, headObject, deleteObject, getPublicUrl", async () => {
    expect(typeof storage.presignPut).toBe("function");
    expect(typeof storage.exists).toBe("function");
    expect(typeof storage.headObject).toBe("function");
    expect(typeof storage.deleteObject).toBe("function");
    expect(typeof storage.getPublicUrl).toBe("function");
    expect(typeof storage.putObject).toBe("function");

    const presigned = await storage.presignPut(`${EVENT_ID}/media/test-key-123.jpg`, {
      contentType: "image/jpeg",
    });
    expect(presigned.url).toContain("http://localhost:9000");
    expect(presigned.url).toContain("presigned=1");
    expect(presigned.key).toBe(`${EVENT_ID}/media/test-key-123.jpg`);
    expect(presigned.bucket).toBe("pgegypt-media");
    expect(presigned.expiresIn).toBeGreaterThan(0);

    const url = storage.getPublicUrl(presigned.key);
    expect(url).toContain("pgegypt-media");
    expect(url).toContain(encodeURIComponent(presigned.key.split("/").pop()!));
  });

  it("s3-storage factory is importable (prod shape) even when memory is used for tests", async () => {
    // Dynamic import to verify file exists and exports factory — no MinIO needed
    const mod = await import("@pgegypt/storage");
    expect(typeof mod.createS3Storage).toBe("function");
    expect(typeof mod.createMinioLocalStorage).toBe("function");
    expect(typeof mod.isAllowedMime).toBe("function");
    expect(typeof mod.buildStorageKey).toBe("function");
    // Check constants
    expect(ALLOWED_MIME_TYPES.length).toBeGreaterThan(0);
    expect(MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
  });

  it("no KV/DO/Images used — storage package only uses S3 SDK or memory", async () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "../../packages/storage/package.json"), "utf-8")
    ) as Record<string, unknown>;
    const deps = JSON.stringify(pkg);
    expect(deps).not.toMatch(/kv|durable|do:|images/i);
    // Allow S3 SDK, not Cloudflare KV/DO
    expect(deps).toMatch(/@aws-sdk\/client-s3/);
  });
});

describe("POST /v1/media/presign — media:WRITE, mime allowlist, max size, pending row", () => {
  it("401 when unauthenticated", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const res = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "photo.jpg", mimeType: "image/jpeg", size: 1024 }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("UNAUTHORIZED");
  });

  it("403 when ADMIN without media:WRITE", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", []);
    const res = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({ filename: "photo.jpg", mimeType: "image/jpeg", size: 1024 }),
    });
    expect(res.status).toBe(403);
  });

  it("SUPER_ADMIN bypass, WRITE implies READ — presign succeeds", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("SUPER_ADMIN", []);
    const res = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({
        filename: "avatar.png",
        mimeType: "image/png",
        size: 2048,
        prefix: "speakers",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(typeof body.data.url).toBe("string");
    expect(body.data.url as string).toContain("http://localhost:9000");
    expect(body.data.status).toBe("pending");
  });

  it("ADMIN with media:WRITE can presign, media:READ cannot", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const writeHeader = testUserHeader("ADMIN", ["media:WRITE"]);
    const readHeader = testUserHeader("ADMIN", ["media:READ"]);
    const ok = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writeHeader },
      body: JSON.stringify({ filename: "ok.jpg", mimeType: "image/jpeg", size: 1000 }),
    });
    expect(ok.status).toBe(201);
    const fail = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": readHeader },
      body: JSON.stringify({ filename: "fail.jpg", mimeType: "image/jpeg", size: 1000 }),
    });
    expect(fail.status).toBe(403);
  });

  it("validates mime allowlist — rejects unsupported type with 422", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", ["media:WRITE"]);
    const res = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({ filename: "doc.pdf", mimeType: "application/pdf", size: 1000 }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("VALIDATION_ERROR");
  });

  it("validates max size — rejects oversized with 422", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", ["media:WRITE"]);
    const big = MAX_FILE_SIZE + 1;
    const res = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({ filename: "big.jpg", mimeType: "image/jpeg", size: big }),
    });
    expect(res.status).toBe(422);
  });

  it("writes media row status pending, key = {event}/speakers/... not guessable (uuid)", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", ["media:WRITE"]);
    const res = await app.request("/v1/admin/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({
        filename: "speaker.jpg",
        mimeType: "image/jpeg",
        size: 3000,
        prefix: "speakers",
        eventId: EVENT_ID,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; key: string; storageKey: string; bucket: string };
    };
    const key = body.data.key;
    expect(key.startsWith(`${EVENT_ID}/speakers/`)).toBe(true);
    // Not guessable — contains uuid + sanitized filename
    expect(key).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(key).toContain("speaker.jpg");

    const row = sqlite
      .prepare("SELECT id, storage_key, status, mime_type, size FROM media WHERE id=?")
      .get(body.data.id) as
      | { id: string; storage_key: string; status: string; mime_type: string; size: number }
      | undefined;
    expect(row).toBeTruthy();
    expect(row!.status).toBe("pending");
    expect(row!.storage_key).toBe(key);
    expect(row!.mime_type).toBe("image/jpeg");
    expect(row!.size).toBe(3000);
  });

  it("alias /v1/media/presign and /v1/admin/media/presign both work", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", ["media:WRITE"]);
    for (const path of ["/v1/media/presign", "/v1/admin/media/presign"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-User": header },
        body: JSON.stringify({ filename: "alias.jpg", mimeType: "image/jpeg", size: 100 }),
      });
      expect(res.status, path).toBe(201);
    }
  });
});

describe("POST /v1/media/confirm — verifies object exists and flips pending→ready", () => {
  it("404 if object not found in storage (no PUT)", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", ["media:WRITE"]);
    const presign = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({ filename: "notyet.jpg", mimeType: "image/jpeg", size: 500 }),
    });
    const presignBody = (await presign.json()) as { data: { id: string; storageKey: string } };
    const id = presignBody.data.id;

    const confirm = await app.request("/v1/media/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({ id }),
    });
    expect(confirm.status).toBe(404);
    const body = (await confirm.json()) as Record<string, unknown>;
    expect(body.error).toBe("NOT_FOUND");
    expect((body.message as string).toLowerCase()).toContain("not found in storage");

    // Still pending in DB
    const row = sqlite.prepare("SELECT status FROM media WHERE id=?").get(id) as { status: string };
    expect(row.status).toBe("pending");
  });

  it("401 if unauthenticated on confirm", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const res = await app.request("/v1/media/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "some-id" }),
    });
    expect(res.status).toBe(401);
  });

  it("403 if ADMIN without WRITE on confirm", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const writeHeader = testUserHeader("ADMIN", ["media:WRITE"]);
    const presign = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writeHeader },
      body: JSON.stringify({ filename: "needwrite.jpg", mimeType: "image/jpeg", size: 400 }),
    });
    const { id } = ((await presign.json()) as { data: { id: string } }).data;
    const readHeader = testUserHeader("ADMIN", ["media:READ"]);
    const res = await app.request("/v1/media/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": readHeader },
      body: JSON.stringify({ id }),
    });
    expect(res.status).toBe(403);
  });
});

describe("Vitest presign→PUT→confirm flow against mocked S3 (in-memory) passes", () => {
  it("full flow: presign → PUT to storage (simulate) → confirm flips to ready", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", ["media:WRITE"]);

    // 1) Presign
    const presignRes = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({
        filename: "flow-test.png",
        mimeType: "image/png",
        size: 1234,
        prefix: "sponsors",
      }),
    });
    expect(presignRes.status).toBe(201);
    const presignBody = (await presignRes.json()) as {
      data: { id: string; key: string; storageKey: string; url: string };
    };
    const { id, storageKey, url } = presignBody.data;
    expect(url).toContain("http://localhost:9000");
    expect(storageKey).toBeDefined();

    // Verify pending
    const pending = sqlite.prepare("SELECT status, url FROM media WHERE id=?").get(id) as {
      status: string;
      url: string | null;
    };
    expect(pending.status).toBe("pending");
    expect(pending.url).toBeNull();

    // 2) Simulate PUT to MinIO :9000 — via storage.putObject (in-memory)
    const fakeImage = new TextEncoder().encode("fake png bytes for test");
    await storage.putObject(storageKey, fakeImage, { contentType: "image/png" });
    expect(await storage.exists(storageKey)).toBe(true);

    // 3) Confirm
    const confirmRes = await app.request("/v1/media/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({ id }),
    });
    expect(confirmRes.status).toBe(200);
    const confirmBody = (await confirmRes.json()) as {
      data: { id: string; storageKey: string; status: string; url: string };
    };
    expect(confirmBody.data.status).toBe("ready");
    expect(confirmBody.data.storageKey).toBe(storageKey);
    expect(confirmBody.data.url).toContain("pgegypt-media");
    expect(confirmBody.data.url).toContain(storageKey.split("/").pop()!);

    // DB flipped to ready with url
    const ready = sqlite.prepare("SELECT status, url FROM media WHERE id=?").get(id) as {
      status: string;
      url: string | null;
    };
    expect(ready.status).toBe("ready");
    expect(ready.url).toBeTruthy();
    expect(ready.url!).toContain("pgegypt-media");

    // Idempotent confirm — second confirm still 200 ready
    const confirm2 = await app.request("/v1/media/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({ id }),
    });
    expect(confirm2.status).toBe(200);
    expect(((await confirm2.json()) as { data: { status: string } }).data.status).toBe("ready");

    // GET /v1/media/:id with READ can fetch
    const readHeader = testUserHeader("ADMIN", ["media:READ"]);
    const get = await app.request(`/v1/media/${id}`, { headers: { "X-Test-User": readHeader } });
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as { data: { status: string } };
    expect(getBody.data.status).toBe("ready");
  });

  it("confirm also works via /v1/admin/media/confirm alias", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", ["media:WRITE"]);
    const presign = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({ filename: "alias-confirm.jpg", mimeType: "image/jpeg", size: 800 }),
    });
    const { id, storageKey } = (
      (await presign.json()) as { data: { id: string; storageKey: string } }
    ).data;
    await storage.putObject(storageKey, "bytes", { contentType: "image/jpeg" });
    const confirm = await app.request("/v1/admin/media/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({ id }),
    });
    expect(confirm.status).toBe(200);
  });

  it("direct upload flow: presigned URL is PUT-able (simulated) and contains bucket/key", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", ["media:WRITE"]);
    const res = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": header },
      body: JSON.stringify({
        filename: "direct.png",
        mimeType: "image/png",
        size: 500,
        prefix: "avatars",
      }),
    });
    const data = ((await res.json()) as { data: { url: string; key: string; bucket: string } })
      .data;
    expect(data.url).toContain(data.bucket);
    expect(data.url).toContain(encodeURIComponent(data.key.split("/").pop()!));
    // URL host is MinIO :9000 local
    expect(data.url).toMatch(/localhost:9000/);
  });
});

describe("GET /v1/media guarded by READ, DELETE by WRITE; paths not guessable, no public leak", () => {
  it("GET list 401 unauth, 403 without READ, 200 with READ", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const unauth = await app.request("/v1/media");
    expect(unauth.status).toBe(401);

    const noPerm = await app.request("/v1/media", {
      headers: { "X-Test-User": testUserHeader("ADMIN", []) },
    });
    expect(noPerm.status).toBe(403);

    const read = await app.request("/v1/media", {
      headers: { "X-Test-User": testUserHeader("ADMIN", ["media:READ"]) },
    });
    expect(read.status).toBe(200);
    const body = (await read.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET list not accessible without auth — no public list leak", async () => {
    // Create a media entry as WRITE user
    const app = createApp({ db: db as never, storage: storage as never });
    const writeHeader = testUserHeader("ADMIN", ["media:WRITE"]);
    const presign = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writeHeader },
      body: JSON.stringify({ filename: "leak.jpg", mimeType: "image/jpeg", size: 200 }),
    });
    const { id, storageKey } = (
      (await presign.json()) as { data: { id: string; storageKey: string } }
    ).data;
    await storage.putObject(storageKey, "x", { contentType: "image/jpeg" });
    await app.request("/v1/media/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writeHeader },
      body: JSON.stringify({ id }),
    });

    // Try unauth list — must be 401, not 200 leak
    const leak = await app.request("/v1/media");
    expect(leak.status).toBe(401);
    // Try unauth get by id — must be 401
    const getLeak = await app.request(`/v1/media/${id}`);
    expect(getLeak.status).toBe(401);
  });

  it("paths not guessable — two presigns for same filename produce different keys (uuid)", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", ["media:WRITE"]);
    const mk = async () => {
      const r = await app.request("/v1/media/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Test-User": header },
        body: JSON.stringify({ filename: "same.jpg", mimeType: "image/jpeg", size: 100 }),
      });
      return ((await r.json()) as { data: { key: string } }).data.key;
    };
    const k1 = await mk();
    const k2 = await mk();
    expect(k1).not.toBe(k2);
    expect(k1).toMatch(/[0-9a-f]{8}-/i);
    expect(k2).toMatch(/[0-9a-f]{8}-/i);
  });

  it("DELETE requires WRITE, removes from storage and soft-deletes row", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const writeHeader = testUserHeader("ADMIN", ["media:WRITE"]);
    const readHeader = testUserHeader("ADMIN", ["media:READ"]);

    const presign = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writeHeader },
      body: JSON.stringify({ filename: "todelete.jpg", mimeType: "image/jpeg", size: 300 }),
    });
    const { id, storageKey } = (
      (await presign.json()) as { data: { id: string; storageKey: string } }
    ).data;
    await storage.putObject(storageKey, "del", { contentType: "image/jpeg" });
    await app.request("/v1/media/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writeHeader },
      body: JSON.stringify({ id }),
    });
    expect(await storage.exists(storageKey)).toBe(true);

    // READ cannot delete
    const fail = await app.request(`/v1/media/${id}`, {
      method: "DELETE",
      headers: { "X-Test-User": readHeader },
    });
    expect(fail.status).toBe(403);

    // WRITE can delete via both aliases
    const del = await app.request(`/v1/admin/media/${id}`, {
      method: "DELETE",
      headers: { "X-Test-User": writeHeader },
    });
    expect(del.status).toBe(200);

    // Storage deleted
    expect(await storage.exists(storageKey)).toBe(false);
    // DB soft-deleted
    const row = sqlite.prepare("SELECT status, deleted_at FROM media WHERE id=?").get(id) as {
      status: string;
      deleted_at: number | null;
    };
    expect(row.status).toBe("deleted");
    expect(row.deleted_at).not.toBeNull();

    // GET after delete is 404
    const get = await app.request(`/v1/media/${id}`, { headers: { "X-Test-User": writeHeader } });
    expect(get.status).toBe(404);
  });

  it("DELETE 404 for non-existent id", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const header = testUserHeader("ADMIN", ["media:WRITE"]);
    const res = await app.request("/v1/media/does-not-exist", {
      method: "DELETE",
      headers: { "X-Test-User": header },
    });
    expect(res.status).toBe(404);
  });

  it("SUPER_ADMIN can READ and WRITE without explicit perms", async () => {
    const app = createApp({ db: db as never, storage: storage as never });
    const superHeader = testUserHeader("SUPER_ADMIN", []);
    const list = await app.request("/v1/media", { headers: { "X-Test-User": superHeader } });
    expect(list.status).toBe(200);
    const presign = await app.request("/v1/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": superHeader },
      body: JSON.stringify({ filename: "super.jpg", mimeType: "image/jpeg", size: 100 }),
    });
    expect(presign.status).toBe(201);
  });
});

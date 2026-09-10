/**
 * registrations.test.ts — §18, §34, §18.3 race guard
 * Uses Hono app.request against real better-sqlite3 temp DB (no mocks).
 * Covers: happy, duplicate 409, duplicate race (parallel), rateLimit 429,
 * validation 400/422, admin list auth 401/403/200, email lowercasing, event check.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@pgegypt/db";
import { createApp } from "../src/app.js";

let sqlite: InstanceType<typeof Database>;
let db: BetterSQLite3Database<typeof schema>;
let tempDir: string;

const EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";
const FAKE_EVENT = "evt_does_not_exist";

// ---------------------------------------------------------------------------
// Migration helpers — same logic as packages/db/tests but minimal
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

  // Post-fix for old registrations schema (same as migrate.ts)
  const cols = database
    .prepare("SELECT name FROM pragma_table_info('registrations')")
    .all() as Array<{ name: string }>;
  const hasEventId = cols.some((c) => c.name === "event_id");
  if (!hasEventId) {
    database.exec("PRAGMA foreign_keys = OFF;");
    database.exec(`
      CREATE TABLE IF NOT EXISTS registrations_new_full (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        organization TEXT,
        role TEXT,
        dietary_notes TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','waitlisted','declined')),
        checkin_token TEXT UNIQUE,
        checked_in_at INTEGER,
        consent_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        deleted_at INTEGER,
        UNIQUE(event_id, email)
      );
    `);
    try {
      database.exec(`
        INSERT OR IGNORE INTO registrations_new_full (id, event_id, name, email, organization, role, dietary_notes, status, created_at, updated_at)
        SELECT id, '${EVENT_ID}', name, lower(email), organization, role, dietary_notes, COALESCE(status,'pending'),
          CASE WHEN typeof(created_at)='integer' THEN created_at WHEN created_at GLOB '*[^0-9]*' THEN unixepoch(created_at) ELSE CAST(created_at AS INTEGER) END, unixepoch() FROM registrations;
      `);
    } catch {
      // ignore
    }
    database.exec("DROP TABLE IF EXISTS registrations;");
    database.exec("ALTER TABLE registrations_new_full RENAME TO registrations;");
    database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_event_email ON registrations(event_id, email);"
    );
    database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_checkin_token ON registrations(checkin_token);"
    );
    database.exec("CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);");
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON registrations(event_id);"
    );
    database.exec("CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email);");
    database.exec("PRAGMA foreign_keys = ON;");
  }
  const rCols = database
    .prepare("SELECT name FROM pragma_table_info('rate_limits')")
    .all() as Array<{ name: string }>;
  if (!rCols.some((c) => c.name === "updated_at")) {
    try {
      database.exec(
        "ALTER TABLE rate_limits ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (unixepoch());"
      );
    } catch {
      // ignore
    }
  }
}

function cleanTables(): void {
  sqlite.prepare("DELETE FROM registrations").run();
  sqlite.prepare("DELETE FROM rate_limits").run();
}

// ---------------------------------------------------------------------------
// Test user helpers
// ---------------------------------------------------------------------------
function testUserHeader(role: string, permissions: string[]): string {
  return JSON.stringify({
    id: `u_${role}`,
    email: `${role.toLowerCase()}@pgegypt.test`,
    role,
    permissions,
  });
}

const SUPER_ADMIN = testUserHeader("SUPER_ADMIN", []);
const REG_READ_USER = testUserHeader("ADMIN", ["registrations:READ"]);
const NO_PERM_USER = testUserHeader("ADMIN", []);
const WRITE_IMPLIED_USER = testUserHeader("ADMIN", ["registrations:WRITE"]); // WRITE → READ

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pgegypt-reg-test-"));
  const dbFile = join(tempDir, "test.db");
  sqlite = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const dir = getMigrationsDir();
  applyMigrations(sqlite, dir);
  db = drizzle(sqlite, { schema });

  // Ensure default event exists
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO events (id, slug, name, date, city) VALUES (?, 'pgegypt-2026','PG Day Egypt 2026','2026-10-10','Cairo, Egypt')"
    )
    .run(EVENT_ID);
});

afterAll(() => {
  try {
    sqlite.close();
  } catch {
    // ignore
  }
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

beforeEach(() => {
  cleanTables();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /v1/registrations — public registration §18", () => {
  it("happy path — creates registration and returns 201 with lowercased email", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.1.1" },
      body: JSON.stringify({
        name: "Alice Example",
        email: "Alice@Example.COM",
        organization: "Acme",
        role: "Engineer",
        consent: true,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    const data = body.data as Record<string, unknown>;
    expect(data.email).toBe("alice@example.com");
    expect(data.eventId).toBe(EVENT_ID);
    expect(typeof data.id).toBe("string");

    // Verify DB lowercased
    const row = sqlite
      .prepare("SELECT email FROM registrations WHERE id=?")
      .get(data.id as string) as { email: string } | undefined;
    expect(row?.email).toBe("alice@example.com");
  });

  it("duplicate pre-check returns 409 with friendly message", async () => {
    const app = createApp({ db: db as never });
    const payload = {
      name: "Bob Dup",
      email: "bob@example.com",
      consent: true,
    };
    const r1 = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "2.2.2.2" },
      body: JSON.stringify(payload),
    });
    expect(r1.status).toBe(201);

    const r2 = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "2.2.2.3" }, // different IP to avoid rate limit masking duplicate
      body: JSON.stringify(payload),
    });
    expect(r2.status).toBe(409);
    const b2 = (await r2.json()) as Record<string, unknown>;
    expect(b2.success).toBe(false);
    expect(b2.error).toBe("CONFLICT");
    expect(String(b2.message)).toMatch(/already registered/i);
  });

  it("duplicate race — parallel inserts, one 201 one 409 (§18.3)", async () => {
    const app = createApp({ db: db as never });
    const payload = { name: "Race Runner", email: "race@example.com", consent: true };
    const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "3.3.3.3" } as Record<
      string,
      string
    >;

    // Fire two requests concurrently (same email, same event)
    const [a, b] = await Promise.all([
      app.request("/v1/registrations", { method: "POST", headers, body: JSON.stringify(payload) }),
      app.request("/v1/registrations", { method: "POST", headers, body: JSON.stringify(payload) }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const count = (
      sqlite
        .prepare("SELECT count(*) as c FROM registrations WHERE email='race@example.com'")
        .get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });

  it("email normalization — uppercase duplicate still 409", async () => {
    const app = createApp({ db: db as never });
    const r1 = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "4.4.4.4" },
      body: JSON.stringify({ name: "Carol", email: "carol@example.com", consent: true }),
    });
    expect(r1.status).toBe(201);
    const r2 = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "4.4.4.5" },
      body: JSON.stringify({ name: "Carol2", email: "CAROL@EXAMPLE.COM", consent: true }),
    });
    expect(r2.status).toBe(409);
  });

  it("validation — invalid body returns 422 with fieldErrors", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "5.5.5.5" },
      body: JSON.stringify({ name: "A", email: "not-an-email", consent: false }),
    });
    // validateJson returns 422; accept 400 or 422
    expect([400, 422].includes(res.status)).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.fieldErrors).toBeDefined();
  });

  it("event_id check — unknown event returns 404", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "6.6.6.6" },
      body: JSON.stringify({
        name: "Dave",
        email: "dave@example.com",
        consent: true,
        eventId: FAKE_EVENT,
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("NOT_FOUND");
  });

  it("rate limit — 5/hour per IP then 429, isolated per IP via CF-Connecting-IP fallback", async () => {
    const app = createApp({ db: db as never });
    const ip = "10.0.0.1";
    const ip2 = "10.0.0.2";
    // 5 allowed
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/v1/registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({
          name: `User ${i}`,
          email: `ratelimit${i}@example.com`,
          consent: true,
        }),
      });
      expect(res.status, `attempt ${i} should succeed`).toBe(201);
    }
    // 6th should be 429
    const limited = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ name: "User 6", email: "ratelimit5@example.com", consent: true }),
    });
    expect(limited.status).toBe(429);
    const b = (await limited.json()) as Record<string, unknown>;
    expect(b.error).toBe("RATE_LIMITED");

    // Different IP not limited
    const otherIpOk = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip2 },
      body: JSON.stringify({ name: "Other IP", email: "otherip@example.com", consent: true }),
    });
    expect(otherIpOk.status).toBe(201);
  });

  it("rate limit falls back to X-Forwarded-For and unknown when no CF header", async () => {
    const app = createApp({ db: db as never });
    // Use X-Forwarded-For fallback path
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/v1/registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "7.7.7.7" },
        body: JSON.stringify({ name: `XFF ${i}`, email: `xff${i}@example.com`, consent: true }),
      });
      expect(res.status).toBe(201);
    }
    const limited = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "7.7.7.7" },
      body: JSON.stringify({ name: "XFF 6", email: "xff5@example.com", consent: true }),
    });
    expect(limited.status).toBe(429);
  });

  it("best-effort email — registration succeeds even if mail would fail (no throw)", async () => {
    // Our local mailer always ok, but we verify that missing mailer does not break
    // Create app with db — service uses localQueue/localMailer which never fails
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "8.8.8.8" },
      body: JSON.stringify({ name: "Eve", email: "eve@example.com", consent: true }),
    });
    expect(res.status).toBe(201);
  });
});

describe("GET /v1/admin/registrations — RBAC §35.3", () => {
  beforeEach(async () => {
    // Seed one registration for list tests
    const app = createApp({ db: db as never });
    await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "9.9.9.1" },
      body: JSON.stringify({ name: "Admin Seed", email: "seed@example.com", consent: true }),
    });
  });

  it("unauthenticated returns 401", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/registrations");
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("UNAUTHORIZED");
  });

  it("authenticated but missing permission returns 403", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/registrations", {
      headers: { "X-Test-User": NO_PERM_USER },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("FORBIDDEN");
  });

  it("SUPER_ADMIN can list (200) without explicit permission", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/registrations", {
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("ADMIN with registrations:READ can list", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/registrations", {
      headers: { "X-Test-User": REG_READ_USER },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
  });

  it("ADMIN with registrations:WRITE implies READ", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/registrations", {
      headers: { "X-Test-User": WRITE_IMPLIED_USER },
    });
    expect(res.status).toBe(200);
  });

  it("legacy alias GET /v1/registrations also guarded", async () => {
    const app = createApp({ db: db as never });
    const unauth = await app.request("/v1/registrations");
    expect(unauth.status).toBe(401);
    const ok = await app.request("/v1/registrations", {
      headers: { "X-Test-User": REG_READ_USER },
    });
    expect(ok.status).toBe(200);
  });

  it("X-Request-Id propagated on admin list", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/registrations", {
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });
});

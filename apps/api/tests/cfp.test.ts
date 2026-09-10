/**
 * cfp.test.ts — §19, §34
 * Uses Hono app.request against real better-sqlite3 temp DB (no mocks).
 * Covers: valid submit 201 + transactional speakers, email normalization,
 * validation 422, rateLimit 429 per IP anonymous, mine list auth-lite via email query.
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
// Migration helpers — mirrors registrations.test.ts
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

  // Post-fix for old registrations schema (same as migrate.ts) — keep for parity
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
  try {
    sqlite.prepare("DELETE FROM cfp_submission_speakers").run();
  } catch {
    // ignore if not exists
  }
  try {
    sqlite.prepare("DELETE FROM cfp_submissions").run();
  } catch {
    // ignore
  }
  try {
    sqlite.prepare("DELETE FROM rate_limits").run();
  } catch {
    // ignore
  }
  // Also clean registrations to avoid rate limit bleed via shared table but different keys — already cfp: vs registrations: isolated, but clean anyway
  try {
    sqlite.prepare("DELETE FROM registrations").run();
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Helpers — payload factories
// ---------------------------------------------------------------------------
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Deep Dive into PostgreSQL Indexing",
    abstract:
      "A comprehensive session covering B-Tree, GIN, GiST, and BRIN indexes with real-world query plans, performance benchmarks, and pitfalls. Attendees will learn how to choose the right index type.",
    track: "postgres-internals",
    level: "intermediate" as const,
    submitterName: "Alice Example",
    submitterEmail: "alice@example.com",
    submitterBio: "Postgres DBA for 5 years, organizer of local PG meetup.",
    coSpeakers: [{ name: "Bob Co", email: "bob@example.com", bio: "Co-speaker bio" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pgegypt-cfp-test-"));
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
// Tests — POST /v1/cfp/submissions
// ---------------------------------------------------------------------------
describe("POST /v1/cfp/submissions — anonymous CFP submit §19", () => {
  it("happy path — creates submission + speakers transactionally, returns 201 with submitted status and lowercased email", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.1.1" },
      body: JSON.stringify(validPayload()),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    const data = body.data as Record<string, unknown>;
    expect(typeof data.id).toBe("string");
    expect(data.email).toBe("alice@example.com");
    expect(data.eventId).toBe(EVENT_ID);
    expect(data.status).toBe("submitted");
    // Verify DB rows
    const sub = sqlite
      .prepare("SELECT id, title, status, submitter_email FROM cfp_submissions WHERE id=?")
      .get(data.id as string) as
      { id: string; title: string; status: string; submitter_email: string } | undefined;
    expect(sub).toBeDefined();
    expect(sub?.status).toBe("submitted");
    expect(sub?.submitter_email).toBe("alice@example.com");
    const speakers = sqlite
      .prepare("SELECT count(*) as c FROM cfp_submission_speakers WHERE submission_id=?")
      .get(data.id as string) as { c: number };
    // primary + 1 coSpeaker = 2
    expect(speakers.c).toBe(2);
    const primary = sqlite
      .prepare(
        "SELECT email, is_primary FROM cfp_submission_speakers WHERE submission_id=? AND is_primary=1"
      )
      .get(data.id as string) as { email: string; is_primary: number } | undefined;
    expect(primary?.email).toBe("alice@example.com");
    expect(primary?.is_primary).toBe(1);
  });

  it("email normalization — uppercase submitter and coSpeaker emails lowercased", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.2.1" },
      body: JSON.stringify(
        validPayload({
          submitterEmail: "Alice@Example.COM",
          coSpeakers: [{ name: "Bob Co", email: "BOB@EXAMPLE.COM", bio: "hi" }],
        })
      ),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;
    expect(data.email).toBe("alice@example.com");
    const rows = sqlite
      .prepare(
        "SELECT email FROM cfp_submission_speakers WHERE submission_id=? ORDER BY is_primary DESC"
      )
      .all(data.id as string) as Array<{ email: string }>;
    expect(rows[0].email).toBe("alice@example.com");
    expect(rows[1].email).toBe("bob@example.com");
  });

  it("supports alias sessionType and speakers array and notes", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.3.1" },
      body: JSON.stringify({
        title: "Alias talk via sessionType",
        abstract:
          "Abstract long enough to pass validation requirements for the alias test case payload.",
        sessionType: "community",
        level: "beginner",
        submitterName: "Carol Alias",
        submitterEmail: "carol@example.com",
        notes: "Bio via notes field",
        speakers: [
          { name: "Carol Alias", email: "carol@example.com", bio: "primary via speakers" },
          { name: "Dave", email: "dave@example.com", bio: "co via speakers" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;
    const sub = sqlite
      .prepare("SELECT track, submitter_bio FROM cfp_submissions WHERE id=?")
      .get(data.id as string) as { track: string | null; submitter_bio: string | null } | undefined;
    expect(sub?.track).toBe("community");
    expect(sub?.submitter_bio).toBe("Bio via notes field");
    const count = (
      sqlite
        .prepare("SELECT count(*) as c FROM cfp_submission_speakers WHERE submission_id=?")
        .get(data.id as string) as { c: number }
    ).c;
    // primary + 1 co (dave) = 2, carol duplicate in speakers should be deduped
    expect(count).toBe(2);
  });

  it("validation — missing title returns 422 with fieldErrors", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "5.5.5.5" },
      body: JSON.stringify({
        abstract: "This abstract is long enough but title is missing entirely.",
        submitterName: "No Title",
        submitterEmail: "notitle@example.com",
      }),
    });
    expect([400, 422].includes(res.status)).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.fieldErrors).toBeDefined();
  });

  it("validation — short abstract returns 422", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "5.5.5.6" },
      body: JSON.stringify({
        title: "Valid Title Here",
        abstract: "Too short",
        submitterName: "Bob",
        submitterEmail: "bob2@example.com",
      }),
    });
    expect([400, 422].includes(res.status)).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("VALIDATION_ERROR");
  });

  it("validation — invalid speaker email returns 422", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "5.5.5.7" },
      body: JSON.stringify(
        validPayload({ coSpeakers: [{ name: "Bad", email: "not-an-email", bio: "x" }] })
      ),
    });
    expect([400, 422].includes(res.status)).toBe(true);
  });

  it("event check — unknown event returns 404", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "6.6.6.6" },
      body: JSON.stringify(validPayload({ eventId: FAKE_EVENT })),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("NOT_FOUND");
  });

  it("rate limit — 5/hour per IP then 429, isolated per IP", async () => {
    const app = createApp({ db: db as never });
    const ip = "10.0.0.1";
    const ip2 = "10.0.0.2";
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/v1/cfp/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify(
          validPayload({
            title: `Rate Talk ${i} unique title`,
            submitterEmail: `ratelimit${i}@example.com`,
            submitterName: `User ${i}`,
            coSpeakers: [],
          })
        ),
      });
      expect(res.status, `attempt ${i} should be 201`).toBe(201);
    }
    const limited = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify(
        validPayload({
          title: "Rate Talk 6",
          submitterEmail: "ratelimit5@example.com",
          submitterName: "User 6",
          coSpeakers: [],
        })
      ),
    });
    expect(limited.status).toBe(429);
    const b = (await limited.json()) as Record<string, unknown>;
    expect(b.error).toBe("RATE_LIMITED");

    // Different IP not limited
    const otherOk = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip2 },
      body: JSON.stringify(
        validPayload({
          title: "Other IP Talk",
          submitterEmail: "otherip@example.com",
          submitterName: "Other",
          coSpeakers: [],
        })
      ),
    });
    expect(otherOk.status).toBe(201);
  });

  it("rate limit falls back to X-Forwarded-For when CF header missing", async () => {
    const app = createApp({ db: db as never });
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/v1/cfp/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "7.7.7.7" },
        body: JSON.stringify(
          validPayload({
            title: `XFF Talk ${i}`,
            submitterEmail: `xff${i}@example.com`,
            submitterName: `XFF ${i}`,
            coSpeakers: [],
          })
        ),
      });
      expect(res.status).toBe(201);
    }
    const limited = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "7.7.7.7" },
      body: JSON.stringify(
        validPayload({
          title: "XFF Talk 6",
          submitterEmail: "xff5@example.com",
          submitterName: "XFF 6",
          coSpeakers: [],
        })
      ),
    });
    expect(limited.status).toBe(429);
  });

  it("idempotency token optional — submission succeeds with or without header", async () => {
    const app = createApp({ db: db as never });
    const without = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "8.8.8.1" },
      body: JSON.stringify(validPayload({ submitterEmail: "idem1@example.com" })),
    });
    expect(without.status).toBe(201);
    const withHeader = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "8.8.8.2",
        "Idempotency-Key": "tok-123",
      },
      body: JSON.stringify(validPayload({ submitterEmail: "idem2@example.com" })),
    });
    expect(withHeader.status).toBe(201);
  });

  it("no coSpeakers — only primary speaker inserted", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "9.9.9.1" },
      body: JSON.stringify(validPayload({ coSpeakers: [] })),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;
    const count = (
      sqlite
        .prepare("SELECT count(*) as c FROM cfp_submission_speakers WHERE submission_id=?")
        .get(data.id as string) as { c: number }
    ).c;
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/cfp/submissions/mine — auth-lite public list
// ---------------------------------------------------------------------------
describe("GET /v1/cfp/submissions/mine — auth-lite public list", () => {
  it("no auth required — returns 200 and empty when no submissions for email", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions/mine?email=nomatch@example.com");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect((body.meta as Record<string, unknown>).count).toBe(0);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("returns only submissions for given email (case-insensitive) and respects isolation", async () => {
    const app = createApp({ db: db as never });
    // Create 2 for alice, 1 for bob
    const payloads = [
      validPayload({
        title: "Alice Talk 1",
        submitterEmail: "alice@example.com",
        submitterName: "Alice",
        coSpeakers: [],
      }),
      validPayload({
        title: "Alice Talk 2",
        submitterEmail: "Alice@Example.COM",
        submitterName: "Alice",
        coSpeakers: [],
      }),
      validPayload({
        title: "Bob Talk 1",
        submitterEmail: "bob@example.com",
        submitterName: "Bob",
        coSpeakers: [],
      }),
    ];
    for (let i = 0; i < payloads.length; i++) {
      const r = await app.request("/v1/cfp/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": `11.0.0.${i}` },
        body: JSON.stringify(payloads[i]),
      });
      expect(r.status).toBe(201);
    }

    const aliceRes = await app.request("/v1/cfp/submissions/mine?email=alice@example.com");
    expect(aliceRes.status).toBe(200);
    const aliceBody = (await aliceRes.json()) as Record<string, unknown>;
    const aliceData = aliceBody.data as Array<Record<string, unknown>>;
    expect(aliceData.length).toBe(2);
    expect((aliceBody.meta as Record<string, unknown>).count).toBe(2);

    // Case-insensitive query
    const aliceUpper = await app.request("/v1/cfp/submissions/mine?email=ALICE@EXAMPLE.COM");
    expect(aliceUpper.status).toBe(200);
    const upperBody = (await aliceUpper.json()) as Record<string, unknown>;
    expect((upperBody.data as unknown[]).length).toBe(2);

    const bobRes = await app.request("/v1/cfp/submissions/mine?email=bob@example.com");
    expect(bobRes.status).toBe(200);
    expect(((await bobRes.json()) as Record<string, unknown>).data).toHaveLength(1);
  });

  it("missing email query param returns 400/422", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions/mine");
    expect([400, 422].includes(res.status)).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe("VALIDATION_ERROR");
  });

  it("invalid email query param returns 400/422", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/cfp/submissions/mine?email=not-an-email");
    expect([400, 422].includes(res.status)).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("VALIDATION_ERROR");
  });

  it("does not require auth — even with no X-Test-User header", async () => {
    const app = createApp({ db: db as never });
    // Ensure unauthenticated request succeeds
    const res = await app.request("/v1/cfp/submissions/mine?email=alice@example.com");
    expect(res.status).toBe(200);
    // Also ensure with auth it still works (no interference)
    const withAuth = await app.request("/v1/cfp/submissions/mine?email=alice@example.com", {
      headers: {
        "X-Test-User": JSON.stringify({
          id: "u1",
          email: "admin@test",
          role: "ADMIN",
          permissions: [],
        }),
      },
    });
    expect(withAuth.status).toBe(200);
  });

  it("filters by eventId when provided", async () => {
    const app = createApp({ db: db as never });
    // Create one submission (default event)
    const r = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "12.0.0.1" },
      body: JSON.stringify(validPayload({ submitterEmail: "eventfilter@example.com" })),
    });
    expect(r.status).toBe(201);

    const ok = await app.request(
      `/v1/cfp/submissions/mine?email=eventfilter@example.com&eventId=${EVENT_ID}`
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Record<string, unknown>).data as unknown[]).toHaveLength(1);

    const wrongEvent = await app.request(
      "/v1/cfp/submissions/mine?email=eventfilter@example.com&eventId=evt_nonexistent"
    );
    expect(wrongEvent.status).toBe(404);
  });

  it("legacy alias /v1/cfp/mine also works", async () => {
    const app = createApp({ db: db as never });
    const r = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "13.0.0.1" },
      body: JSON.stringify(validPayload({ submitterEmail: "alias@example.com" })),
    });
    expect(r.status).toBe(201);
    const mine = await app.request("/v1/cfp/mine?email=alias@example.com");
    expect(mine.status).toBe(200);
    const body = (await mine.json()) as Record<string, unknown>;
    expect((body.data as unknown[]).length).toBe(1);
  });
});

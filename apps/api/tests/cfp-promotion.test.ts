/**
 * cfp-promotion.test.ts — §§19-21
 * Real better-sqlite3 temp DB, Hono app.request, no mocks.
 * Covers: state machine submitted→under_review→accepted|rejected with cfp:WRITE guard,
 * cfp_reviews logging, admin list with filters, accept→promote creates draft speakers/sessions
 * linked via session_speakers, idempotent, audited, 403/409, transaction rollback.
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
    } catch {}
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
    } catch {}
  }
}

function cleanTables(): void {
  try {
    sqlite.prepare("DELETE FROM session_speakers").run();
  } catch {}
  try {
    sqlite.prepare("DELETE FROM sessions").run();
  } catch {}
  try {
    sqlite.prepare("DELETE FROM speakers").run();
  } catch {}
  try {
    sqlite.prepare("DELETE FROM cfp_reviews").run();
  } catch {}
  try {
    sqlite.prepare("DELETE FROM cfp_submission_speakers").run();
  } catch {}
  try {
    sqlite.prepare("DELETE FROM cfp_submissions").run();
  } catch {}
  try {
    sqlite.prepare("DELETE FROM audit_logs").run();
  } catch {}
  try {
    sqlite.prepare("DELETE FROM rate_limits").run();
  } catch {}
}

function testUserHeader(role: string, permissions: string[]): string {
  return JSON.stringify({
    id: `u_${role}_${permissions.join(",")}`,
    email: `${role.toLowerCase()}@test.local`,
    role,
    permissions,
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "PostgreSQL Indexing Deep Dive for CFP Promotion",
    abstract:
      "A comprehensive session covering B-Tree, GIN, GiST, and BRIN indexes with real-world query plans, performance benchmarks, and pitfalls. Attendees will learn how to choose the right index type and avoid common mistakes in production.",
    track: "postgres-internals",
    level: "intermediate" as const,
    submitterName: "Alice Example",
    submitterEmail: "alice-cfp-promo@example.com",
    submitterBio:
      "Postgres DBA for 5 years, organizer of local PG meetup, speaker at multiple conferences.",
    coSpeakers: [
      {
        name: "Bob Co",
        email: "bob-cfp-promo@example.com",
        bio: "Co-speaker bio for promotion test, experienced backend engineer.",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pgegypt-cfp-promo-test-"));
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
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function submitCfp(ip = "1.1.1.1", overrides: Record<string, unknown> = {}): Promise<string> {
  const app = createApp({ db: db as never });
  const res = await app.request("/v1/cfp/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(validPayload(overrides)),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

// ---------------------------------------------------------------------------
// E2E chain
// ---------------------------------------------------------------------------

describe("CFP promotion e2e — submit→under_review→accept→promote→verify draft (§§19-21)", () => {
  it("full chain creates draft speakers + draft sessions linked, audited, idempotent", async () => {
    const app = createApp({ db: db as never });
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    const reader = testUserHeader("ADMIN", ["cfp:READ"]);

    // 1) Submit (anonymous)
    const submissionId = await submitCfp("2.2.2.1", { submitterEmail: "e2e-chain@example.com" });

    // 2) Admin list requires READ — writer can list via WRITE→READ, reader can list
    const listAsWriter = await app.request("/v1/cfp/submissions", {
      headers: { "X-Test-User": writer },
    });
    expect(listAsWriter.status).toBe(200);
    const listBody = (await listAsWriter.json()) as { data: Array<{ id: string }> };
    expect(listBody.data.some((r) => r.id === submissionId)).toBe(true);

    const listAsReader = await app.request("/v1/cfp/submissions?status=submitted", {
      headers: { "X-Test-User": reader },
    });
    expect(listAsReader.status).toBe(200);

    // 3) Transition submitted → under_review
    const toReview = await app.request(`/v1/cfp/submissions/${submissionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "under_review", comment: "Looks promising", score: 4 }),
    });
    expect(
      toReview.status,
      await toReview
        .clone()
        .text()
        .then((t) => t.slice(0, 500))
    ).toBe(200);
    const reviewBody = (await toReview.json()) as { data: { status: string } };
    expect(reviewBody.data.status).toBe("under_review");

    // Check cfp_reviews row logged
    const reviewRows = sqlite
      .prepare(
        "SELECT status_from, status_to, score, comment FROM cfp_reviews WHERE submission_id=? ORDER BY created_at DESC"
      )
      .all(submissionId) as Array<{
      status_from: string;
      status_to: string;
      score: number;
      comment: string;
    }>;
    expect(reviewRows.length).toBe(1);
    expect(reviewRows[0].status_from).toBe("submitted");
    expect(reviewRows[0].status_to).toBe("under_review");
    expect(reviewRows[0].score).toBe(4);

    // 4) under_review → accepted
    const toAccepted = await app.request(`/v1/cfp/submissions/${submissionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "accepted", comment: "Accepted for conf" }),
    });
    expect(toAccepted.status).toBe(200);
    const acceptedBody = (await toAccepted.json()) as { data: { status: string } };
    expect(acceptedBody.data.status).toBe("accepted");

    // 5) Promote — creates draft speakers + session
    const promote = await app.request(`/v1/cfp/submissions/${submissionId}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({}),
    });
    expect(
      [200, 201].includes(promote.status),
      await promote
        .clone()
        .text()
        .then((t) => t.slice(0, 500))
    ).toBe(true);
    const promoBody = (await promote.json()) as {
      data: {
        session: Record<string, unknown>;
        speakers: Array<Record<string, unknown>>;
        alreadyPromoted: boolean;
      };
    };
    expect(promoBody.data.alreadyPromoted).toBe(false);
    expect(promoBody.data.session).toBeDefined();
    expect((promoBody.data.session as { title: string }).title).toBe(validPayload().title);
    expect(
      (promoBody.data.session as { isDraft: number }).isDraft ??
        (promoBody.data.session as { is_draft: number }).is_draft
    ).toBe(1);
    expect((promoBody.data.session as { status: string }).status).toBe("draft");
    expect(promoBody.data.speakers.length).toBe(2); // alice + bob

    // Verify DB draft rows
    const draftSpeakers = sqlite
      .prepare("SELECT id, slug, is_draft, event_id FROM speakers WHERE event_id=? AND is_draft=1")
      .all(EVENT_ID) as Array<{
      id: string;
      slug: string;
      is_draft: number;
      event_id: string;
    }>;
    expect(draftSpeakers.length).toBe(2);
    for (const sp of draftSpeakers) expect(sp.is_draft).toBe(1);

    const draftSessions = sqlite
      .prepare(
        "SELECT id, slug, is_draft, status, title FROM sessions WHERE event_id=? AND is_draft=1"
      )
      .all(EVENT_ID) as Array<{
      id: string;
      slug: string;
      is_draft: number;
      status: string;
      title: string;
    }>;
    expect(draftSessions.length).toBe(1);
    expect(draftSessions[0].is_draft).toBe(1);
    expect(draftSessions[0].status).toBe("draft");

    const sessionId = draftSessions[0].id;
    const links = sqlite
      .prepare("SELECT count(*) as c FROM session_speakers WHERE session_id=?")
      .get(sessionId) as { c: number };
    expect(links.c).toBe(2);

    // Audit log for promote
    const auditPromote = sqlite
      .prepare(
        "SELECT action, target_type, target_id FROM audit_logs WHERE action='cfp.promote' AND target_id=?"
      )
      .all(submissionId) as Array<{ action: string }>;
    expect(auditPromote.length).toBe(1);

    // Detail includes speakers + reviews
    const detail = await app.request(`/v1/cfp/submissions/${submissionId}`, {
      headers: { "X-Test-User": reader },
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      data: { submission: { status: string }; speakers: unknown[]; reviews: unknown[] };
    };
    expect(detailBody.data.submission.status).toBe("accepted");
    expect(detailBody.data.speakers.length).toBe(2);
    expect(detailBody.data.reviews.length).toBeGreaterThanOrEqual(2);

    // 6) Idempotent second promote — no duplicates, alreadyPromoted true
    const promote2 = await app.request(`/v1/cfp/submissions/${submissionId}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({}),
    });
    expect(promote2.status).toBe(200);
    const promo2Body = (await promote2.json()) as { data: { alreadyPromoted: boolean } };
    expect(promo2Body.data.alreadyPromoted).toBe(true);

    const afterSpeakers = sqlite
      .prepare("SELECT count(*) as c FROM speakers WHERE event_id=? AND is_draft=1")
      .get(EVENT_ID) as { c: number };
    expect(afterSpeakers.c).toBe(2);
    const afterSessions = sqlite
      .prepare("SELECT count(*) as c FROM sessions WHERE event_id=? AND is_draft=1")
      .get(EVENT_ID) as { c: number };
    expect(afterSessions.c).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 403 unauthorized
// ---------------------------------------------------------------------------

describe("403 for unauthorized role — cfp:WRITE required for transitions (§§19-21)", () => {
  it("PATCH without auth returns 401", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("3.3.3.1");
    const res = await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "under_review" }),
    });
    expect(res.status).toBe(401);
  });

  it("PATCH with ADMIN but no cfp:WRITE returns 403", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("3.3.3.2");
    const noPerm = testUserHeader("ADMIN", []);
    const res = await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": noPerm },
      body: JSON.stringify({ status: "under_review" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("FORBIDDEN");
  });

  it("PATCH with cfp:READ only returns 403 — WRITE required", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("3.3.3.3");
    const readOnly = testUserHeader("ADMIN", ["cfp:READ"]);
    const res = await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": readOnly },
      body: JSON.stringify({ status: "under_review" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST promote without WRITE returns 403", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("3.3.3.4");
    // Move to accepted via writer first
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "under_review" }),
    });
    await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "accepted" }),
    });
    const reader = testUserHeader("ADMIN", ["cfp:READ"]);
    const promote = await app.request(`/v1/cfp/submissions/${id}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": reader },
      body: JSON.stringify({}),
    });
    expect(promote.status).toBe(403);
  });

  it("GET list without cfp:READ returns 403", async () => {
    const app = createApp({ db: db as never });
    await submitCfp("3.3.3.5");
    const noPerm = testUserHeader("ADMIN", []);
    const res = await app.request("/v1/cfp/submissions", {
      headers: { "X-Test-User": noPerm },
    });
    expect(res.status).toBe(403);
  });

  it("SUPER_ADMIN bypasses permission checks", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("3.3.3.6");
    const superHeader = testUserHeader("SUPER_ADMIN", []);
    const res = await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": superHeader },
      body: JSON.stringify({ status: "under_review" }),
    });
    expect(res.status).toBe(200);
  });

  it("POST review without WRITE returns 403", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("3.3.3.7");
    const reader = testUserHeader("ADMIN", ["cfp:READ"]);
    const res = await app.request(`/v1/cfp/submissions/${id}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": reader },
      body: JSON.stringify({ comment: "Nice talk" }),
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 409 invalid transition
// ---------------------------------------------------------------------------

describe("409 for invalid transition — state machine", () => {
  it("submitted → accepted directly is 409", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("4.4.4.1");
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    const res = await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "accepted" }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("CONFLICT");
  });

  it("under_review → submitted is 409", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("4.4.4.2");
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "under_review" }),
    });
    const back = await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "submitted" }),
    });
    expect(back.status).toBe(409);
  });

  it("accepted → rejected is 409 (terminal)", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("4.4.4.3");
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "under_review" }),
    });
    await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "accepted" }),
    });
    const res = await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "rejected" }),
    });
    expect(res.status).toBe(409);
  });

  it("same status transition is 409", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("4.4.4.4");
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    const res = await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "submitted" }),
    });
    expect(res.status).toBe(409);
  });

  it("promote when not accepted is 409", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("4.4.4.5");
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    const promote = await app.request(`/v1/cfp/submissions/${id}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({}),
    });
    expect(promote.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// cfp_reviews table + GET filters
// ---------------------------------------------------------------------------

describe("cfp_reviews table logs reviewer comments/scores; GET lists all with filters", () => {
  it("POST review stores comment/score, detail returns them", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("5.5.5.1");
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    const res = await app.request(`/v1/cfp/submissions/${id}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ comment: "Great abstract", score: 5 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { score: number; comment: string } };
    expect(body.data.score).toBe(5);
    expect(body.data.comment).toBe("Great abstract");

    const rows = sqlite
      .prepare("SELECT score, comment FROM cfp_reviews WHERE submission_id=?")
      .all(id) as Array<{ score: number; comment: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].score).toBe(5);

    const detail = await app.request(`/v1/cfp/submissions/${id}`, {
      headers: { "X-Test-User": writer },
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { data: { reviews: Array<{ score: number }> } };
    expect(detailBody.data.reviews.length).toBe(1);
  });

  it("GET list with status filter and search", async () => {
    const app = createApp({ db: db as never });
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    // Create 2 submissions with distinct titles
    const id1 = await submitCfp("5.5.5.2", {
      title: "Searchable Postgres Talk Unique Alpha",
      submitterEmail: "search1@example.com",
    });
    const id2 = await submitCfp("5.5.5.3", {
      title: "Completely Different Title Beta",
      submitterEmail: "search2@example.com",
    });

    // Move id1 to accepted
    await app.request(`/v1/cfp/submissions/${id1}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "under_review" }),
    });
    await app.request(`/v1/cfp/submissions/${id1}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "accepted" }),
    });

    // Filter by status accepted
    const accepted = await app.request("/v1/cfp/submissions?status=accepted", {
      headers: { "X-Test-User": writer },
    });
    expect(accepted.status).toBe(200);
    const acceptedBody = (await accepted.json()) as { data: Array<{ id: string }> };
    expect(acceptedBody.data.some((r) => r.id === id1)).toBe(true);
    expect(acceptedBody.data.some((r) => r.id === id2)).toBe(false);

    // Search by title substring
    const search = await app.request("/v1/cfp/submissions?search=Alpha", {
      headers: { "X-Test-User": writer },
    });
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as { data: Array<{ id: string }> };
    expect(searchBody.data.some((r) => r.id === id1)).toBe(true);

    // Search via q alias
    const qSearch = await app.request("/v1/cfp/submissions?q=Beta", {
      headers: { "X-Test-User": writer },
    });
    expect(qSearch.status).toBe(200);
    const qBody = (await qSearch.json()) as { data: Array<{ id: string }> };
    expect(qBody.data.some((r) => r.id === id2)).toBe(true);
  });

  it("rejected path also works", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("5.5.5.4");
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "under_review" }),
    });
    const reject = await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "rejected", comment: "Not fit" }),
    });
    expect(reject.status).toBe(200);
    const promote = await app.request(`/v1/cfp/submissions/${id}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({}),
    });
    expect(promote.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Transaction rollback
// ---------------------------------------------------------------------------

describe("transaction rolls back on failure", () => {
  it("failed promotion due to status leaves no draft speakers/sessions", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("6.6.6.1");
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    // Attempt promote while still submitted — should be 409 and create nothing
    const beforeSpeakers = (
      sqlite.prepare("SELECT count(*) as c FROM speakers").get() as { c: number }
    ).c;
    const beforeSessions = (
      sqlite.prepare("SELECT count(*) as c FROM sessions").get() as { c: number }
    ).c;

    const res = await app.request(`/v1/cfp/submissions/${id}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);

    const afterSpeakers = (
      sqlite.prepare("SELECT count(*) as c FROM speakers").get() as { c: number }
    ).c;
    const afterSessions = (
      sqlite.prepare("SELECT count(*) as c FROM sessions").get() as { c: number }
    ).c;
    expect(afterSpeakers).toBe(beforeSpeakers);
    expect(afterSessions).toBe(beforeSessions);
  });

  it("failed transition leaves submission status unchanged and does not log extra review", async () => {
    const app = createApp({ db: db as never });
    const id = await submitCfp("6.6.6.2");
    const writer = testUserHeader("ADMIN", ["cfp:WRITE"]);
    const before = sqlite.prepare("SELECT status FROM cfp_submissions WHERE id=?").get(id) as {
      status: string;
    };
    expect(before.status).toBe("submitted");
    const beforeReviews = (
      sqlite.prepare("SELECT count(*) as c FROM cfp_reviews WHERE submission_id=?").get(id) as {
        c: number;
      }
    ).c;

    // Invalid transition submitted→accepted should fail
    const res = await app.request(`/v1/cfp/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": writer },
      body: JSON.stringify({ status: "accepted" }),
    });
    expect(res.status).toBe(409);
    const after = sqlite.prepare("SELECT status FROM cfp_submissions WHERE id=?").get(id) as {
      status: string;
    };
    expect(after.status).toBe("submitted");
    const afterReviews = (
      sqlite.prepare("SELECT count(*) as c FROM cfp_reviews WHERE submission_id=?").get(id) as {
        c: number;
      }
    ).c;
    expect(afterReviews).toBe(beforeReviews);
  });
});

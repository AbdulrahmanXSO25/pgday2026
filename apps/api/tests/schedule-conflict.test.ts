/**
 * schedule-conflict.test.ts — §24, §§13-15, §26
 * Uses Hono app.request against real better-sqlite3 temp DB (no mocks).
 * Covers: create/update overlap 409, RBAC 403, validation 422,
 * session_speakers join transactionally, rooms FK only.
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
const ROOM_ID = "room_00000000-0000-7000-8000-000000000001";
let SECOND_ROOM_ID: string;

// ---------------------------------------------------------------------------
// Migration helpers — mirrors other tests
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
    sqlite.prepare("DELETE FROM sponsors").run();
  } catch {}
  // Keep default room, delete others
  try {
    sqlite.prepare("DELETE FROM rooms WHERE id != ?").run(ROOM_ID);
  } catch {}
  // Clean secondary room if created via API, keep ROOM_ID
  try {
    // Ensure default event still exists after cleans
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO events (id, slug, name, date, city) VALUES (?, 'pgegypt-2026','PG Day Egypt 2026','2026-10-10','Cairo, Egypt')"
      )
      .run(EVENT_ID);
  } catch {}
  try {
    sqlite.prepare("DELETE FROM registrations").run();
  } catch {}
  try {
    sqlite.prepare("DELETE FROM rate_limits").run();
  } catch {}
}

// ---------------------------------------------------------------------------
// Helpers
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
const SPEAKERS_WRITE = testUserHeader("ADMIN", ["speakers:WRITE"]);
const SPEAKERS_READ = testUserHeader("ADMIN", ["speakers:READ"]);
const SESSIONS_WRITE = testUserHeader("ADMIN", ["sessions:WRITE"]);
const SESSIONS_READ = testUserHeader("ADMIN", ["sessions:READ"]);
const SPONSORS_WRITE = testUserHeader("ADMIN", ["sponsors:WRITE"]);
const NO_PERM = testUserHeader("ADMIN", []);
const SESSIONS_WRITE_ONLY = testUserHeader("ADMIN", ["sessions:WRITE"]); // implies READ

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pgegypt-schedule-test-"));
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
  // Ensure default room
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO rooms (id, event_id, slug, name, capacity, sort_order) VALUES (?, ?, 'main-hall','Main Hall',300,0)"
    )
    .run(ROOM_ID, EVENT_ID);
  // Create second room for tests
  SECOND_ROOM_ID = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO rooms (id, event_id, slug, name, capacity, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(SECOND_ROOM_ID, EVENT_ID, "room-b", "Room B", 100, 1, now, now);
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
  // Re-ensure second room after clean (clean keeps ROOM_ID only)
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO rooms (id, event_id, slug, name, capacity, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(SECOND_ROOM_ID, EVENT_ID, "room-b", "Room B", 100, 1, now, now);
});

// ---------------------------------------------------------------------------
// Helpers to create via API
// ---------------------------------------------------------------------------
async function createSpeakerViaApi(payload: Record<string, unknown>, header = SPEAKERS_WRITE) {
  const app = createApp({ db: db as never });
  const res = await app.request("/v1/admin/speakers", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-User": header },
    body: JSON.stringify(payload),
  });
  return res;
}

async function createRoomViaApi(payload: Record<string, unknown>, header = SESSIONS_WRITE) {
  const app = createApp({ db: db as never });
  const res = await app.request("/v1/admin/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-User": header },
    body: JSON.stringify(payload),
  });
  return res;
}

async function createSessionViaApi(payload: Record<string, unknown>, header = SESSIONS_WRITE) {
  const app = createApp({ db: db as never });
  const res = await app.request("/v1/admin/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-User": header },
    body: JSON.stringify(payload),
  });
  return res;
}

async function createSponsorViaApi(payload: Record<string, unknown>, header = SPONSORS_WRITE) {
  const app = createApp({ db: db as never });
  const res = await app.request("/v1/admin/sponsors", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-User": header },
    body: JSON.stringify(payload),
  });
  return res;
}

// ---------------------------------------------------------------------------
// Speakers CRUD
// ---------------------------------------------------------------------------
describe("Speakers CRUD — RBAC, Zod, unique slug", () => {
  it("unauthenticated returns 401", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/speakers");
    expect(res.status).toBe(401);
  });

  it("authenticated but missing permission returns 403", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/speakers", { headers: { "X-Test-User": NO_PERM } });
    expect(res.status).toBe(403);
  });

  it("ADMIN with speakers:READ can list (200) — WRITE implies READ", async () => {
    const app = createApp({ db: db as never });
    const readOk = await app.request("/v1/admin/speakers", {
      headers: { "X-Test-User": SPEAKERS_READ },
    });
    expect(readOk.status).toBe(200);
    const writeImplies = await app.request("/v1/admin/speakers", {
      headers: { "X-Test-User": SPEAKERS_WRITE },
    });
    expect(writeImplies.status).toBe(200);
  });

  it("SUPER_ADMIN bypasses permission", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/speakers", {
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    expect(res.status).toBe(200);
  });

  it("create speaker 201 with valid payload", async () => {
    const res = await createSpeakerViaApi({
      slug: "test-speaker",
      name: "Test Speaker",
      bio: "This bio is long enough to pass validation requirements for the speaker entity.",
      role: "Engineer",
      company: "Acme",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    const data = body.data as Record<string, unknown>;
    expect(data.slug as string).toBe("test-speaker");
    expect(typeof data.id).toBe("string");

    // Verify DB
    const row = sqlite
      .prepare("SELECT slug, bio FROM speakers WHERE id=?")
      .get(data.id as string) as { slug: string; bio: string } | undefined;
    expect(row?.slug).toBe("test-speaker");
  });

  it("create speaker validation 422 — short bio", async () => {
    const res = await createSpeakerViaApi({
      slug: "short-bio",
      name: "Short Bio",
      bio: "Too short",
    });
    expect([400, 422].includes(res.status)).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("VALIDATION_ERROR");
  });

  it("duplicate slug same event returns 409", async () => {
    const first = await createSpeakerViaApi({
      slug: "dup-slug",
      name: "First",
      bio: "First speaker bio long enough for validation to pass properly.",
    });
    expect(first.status).toBe(201);
    const second = await createSpeakerViaApi({
      slug: "dup-slug",
      name: "Second",
      bio: "Second speaker bio long enough for validation to pass properly.",
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as Record<string, unknown>;
    expect(body.error).toBe("CONFLICT");
  });

  it("update speaker 200 and alias /v1/speakers works", async () => {
    const created = await createSpeakerViaApi({
      slug: "updatable",
      name: "Updatable",
      bio: "Updatable speaker bio long enough for validation.",
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const sid = id.id as string;
    const app = createApp({ db: db as never });
    const upd = await app.request(`/v1/speakers/${sid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SPEAKERS_WRITE },
      body: JSON.stringify({ name: "Updated Name" }),
    });
    expect(upd.status).toBe(200);
    const body = (await upd.json()) as Record<string, unknown>;
    expect((body.data as Record<string, unknown>).name).toBe("Updated Name");

    // Alias list
    const aliasList = await app.request("/v1/speakers", {
      headers: { "X-Test-User": SPEAKERS_READ },
    });
    expect(aliasList.status).toBe(200);
  });

  it("delete speaker soft deletes", async () => {
    const created = await createSpeakerViaApi({
      slug: "deletable",
      name: "Deletable",
      bio: "Deletable speaker bio long enough for validation.",
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const sid = id.id as string;
    const app = createApp({ db: db as never });
    const del = await app.request(`/v1/admin/speakers/${sid}`, {
      method: "DELETE",
      headers: { "X-Test-User": SPEAKERS_WRITE },
    });
    expect(del.status).toBe(200);
    const row = sqlite.prepare("SELECT deleted_at FROM speakers WHERE id=?").get(sid) as
      { deleted_at: number | null } | undefined;
    expect(row?.deleted_at).not.toBeNull();
    const getAfter = await app.request(`/v1/admin/speakers/${sid}`, {
      headers: { "X-Test-User": SPEAKERS_READ },
    });
    expect(getAfter.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Sponsors CRUD
// ---------------------------------------------------------------------------
describe("Sponsors CRUD — RBAC, Zod", () => {
  it("create sponsor 201 and duplicate slug 409", async () => {
    const first = await createSponsorViaApi({
      slug: "sponsor-a",
      name: "Sponsor A",
      tier: "gold",
      url: "https://example.com",
    });
    expect(first.status).toBe(201);
    const dup = await createSponsorViaApi({
      slug: "sponsor-a",
      name: "Sponsor Dup",
      tier: "gold",
      url: "https://example.com",
    });
    expect(dup.status).toBe(409);
  });

  it("RBAC 403 for sponsors without permission", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/sponsors", { headers: { "X-Test-User": NO_PERM } });
    expect(res.status).toBe(403);
    const ok = await app.request("/v1/admin/sponsors", {
      headers: { "X-Test-User": SPONSORS_WRITE },
    });
    expect(ok.status).toBe(200);
  });

  it("validation 422 — invalid tier", async () => {
    const res = await createSponsorViaApi({
      slug: "bad-tier",
      name: "Bad",
      tier: "diamond",
      url: "https://example.com",
    });
    expect([400, 422].includes(res.status)).toBe(true);
  });

  it("update sponsor 200", async () => {
    const created = await createSponsorViaApi({
      slug: "updatable-sponsor",
      name: "Old Name",
      tier: "silver",
      url: "https://example.com",
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const sid = id.id as string;
    const app = createApp({ db: db as never });
    const upd = await app.request(`/v1/admin/sponsors/${sid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-User": SPONSORS_WRITE },
      body: JSON.stringify({
        name: "New Name",
        slug: "updatable-sponsor",
        tier: "gold",
        url: "https://example.com",
      }),
    });
    expect(upd.status).toBe(200);
    const body = (await upd.json()) as Record<string, unknown>;
    expect((body.data as Record<string, unknown>).name).toBe("New Name");
  });
});

// ---------------------------------------------------------------------------
// Rooms CRUD — sessions:WRITE covers rooms FK only
// ---------------------------------------------------------------------------
describe("Rooms CRUD — FK only, sessions permission", () => {
  it("create room 201 and duplicate slug 409", async () => {
    const first = await createRoomViaApi({ slug: "test-room", name: "Test Room", capacity: 100 });
    expect(first.status).toBe(201);
    const dup = await createRoomViaApi({ slug: "test-room", name: "Other Name", capacity: 50 });
    expect(dup.status).toBe(409);
    const dupName = await createRoomViaApi({ slug: "other-slug", name: "Test Room", capacity: 50 });
    expect(dupName.status).toBe(409);
  });

  it("RBAC — rooms require sessions:READ/WRITE, unauthorized 401, forbidden 403", async () => {
    const app = createApp({ db: db as never });
    const unauth = await app.request("/v1/admin/rooms");
    expect(unauth.status).toBe(401);
    const noPerm = await app.request("/v1/admin/rooms", { headers: { "X-Test-User": NO_PERM } });
    expect(noPerm.status).toBe(403);
    const readOk = await app.request("/v1/admin/rooms", {
      headers: { "X-Test-User": SESSIONS_READ },
    });
    expect(readOk.status).toBe(200);
    const writeImplies = await app.request("/v1/admin/rooms", {
      headers: { "X-Test-User": SESSIONS_WRITE_ONLY },
    });
    expect(writeImplies.status).toBe(200);
  });

  it("list rooms includes seeded Main Hall", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/rooms", { headers: { "X-Test-User": SESSIONS_READ } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data as Array<Record<string, unknown>>;
    expect(data.some((r) => r.slug === "main-hall")).toBe(true);
  });

  it("update room 200", async () => {
    const created = await createRoomViaApi({ slug: "updatable-room", name: "Updatable Room" });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const rid = id.id as string;
    const app = createApp({ db: db as never });
    const upd = await app.request(`/v1/admin/rooms/${rid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SESSIONS_WRITE },
      body: JSON.stringify({ name: "Renamed Room" }),
    });
    expect(upd.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Sessions + schedule conflict 409 + session_speakers transactional
// ---------------------------------------------------------------------------
describe("Sessions CRUD + schedule conflict 409 §24", () => {
  let speakerIdA: string;
  let speakerIdB: string;

  beforeEach(async () => {
    // Create two speakers for join tests (use distinct slugs per test run via random suffix)
    const suffix = Math.random().toString(36).slice(2, 6);
    const s1 = await createSpeakerViaApi({
      slug: `speaker-a-${suffix}`,
      name: "Speaker A",
      bio: "Speaker A bio long enough for validation requirements success.",
    });
    expect(s1.status).toBe(201);
    const rowA = sqlite
      .prepare("SELECT id FROM speakers WHERE slug=?")
      .get(`speaker-a-${suffix}`) as { id: string } | undefined;
    speakerIdA = rowA!.id;

    const s2 = await createSpeakerViaApi({
      slug: `speaker-b-${suffix}`,
      name: "Speaker B",
      bio: "Speaker B bio long enough for validation requirements success.",
    });
    expect(s2.status).toBe(201);
    const rowB = sqlite
      .prepare("SELECT id FROM speakers WHERE slug=?")
      .get(`speaker-b-${suffix}`) as { id: string } | undefined;
    speakerIdB = rowB!.id;
  });

  it("RBAC — sessions require sessions:READ/WRITE", async () => {
    const app = createApp({ db: db as never });
    const unauth = await app.request("/v1/admin/sessions");
    expect(unauth.status).toBe(401);
    const forbidden = await app.request("/v1/admin/sessions", {
      headers: { "X-Test-User": NO_PERM },
    });
    expect(forbidden.status).toBe(403);
    const readOk = await app.request("/v1/admin/sessions", {
      headers: { "X-Test-User": SESSIONS_READ },
    });
    expect(readOk.status).toBe(200);
    const writeImplies = await app.request("/v1/admin/sessions", {
      headers: { "X-Test-User": SESSIONS_WRITE_ONLY },
    });
    expect(writeImplies.status).toBe(200);
  });

  it("create session 201 with speakerIds transactionally", async () => {
    const payload = {
      slug: "session-one",
      title: "Session One Title Here",
      type: "talk",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
      speakerIds: [speakerIdA, speakerIdB],
    };
    const res = await createSessionViaApi(payload);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;
    expect(data.slug as string).toBe("session-one");
    const id = data.id as string;

    // Verify session_speakers join count =2
    const count = (
      sqlite.prepare("SELECT count(*) as c FROM session_speakers WHERE session_id=?").get(id) as {
        c: number;
      }
    ).c;
    expect(count).toBe(2);
    const sids = sqlite
      .prepare("SELECT speaker_id FROM session_speakers WHERE session_id=?")
      .all(id) as Array<{ speaker_id: string }>;
    expect(sids.map((r) => r.speaker_id).sort()).toEqual([speakerIdA, speakerIdB].sort());
  });

  it("session without room and times is allowed (no conflict check)", async () => {
    const res = await createSessionViaApi({
      slug: "no-room-no-time",
      title: "No Room No Time Session",
      type: "talk",
    });
    expect(res.status).toBe(201);
  });

  it("validation 422 — start must be before end (ISO)", async () => {
    const res = await createSessionViaApi({
      slug: "bad-times",
      title: "Bad Times Session Title",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T11:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
    });
    expect([400, 422].includes(res.status)).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("VALIDATION_ERROR");
  });

  it("validation 422 — start must be before end (epoch)", async () => {
    const res = await createSessionViaApi({
      slug: "bad-epoch",
      title: "Bad Epoch Session Title",
      roomId: ROOM_ID,
      startsAtEpoch: 2000,
      endsAtEpoch: 1000,
    });
    expect([400, 422].includes(res.status)).toBe(true);
  });

  it("validation 422 — both times must be provided together", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": SESSIONS_WRITE },
      body: JSON.stringify({
        slug: "half-time",
        title: "Half Time Session Title",
        roomId: ROOM_ID,
        startsAt: "2026-10-10T09:00:00.000Z",
      }),
    });
    expect([400, 422].includes(res.status)).toBe(true);
  });

  it("overlap detection — same room overlapping time returns 409", async () => {
    const first = await createSessionViaApi({
      slug: "first-session",
      title: "First Session Title Here",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
    });
    expect(first.status).toBe(201);

    const overlap = await createSessionViaApi({
      slug: "overlap-session",
      title: "Overlap Session Title Here",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T09:30:00.000Z",
      endsAt: "2026-10-10T10:30:00.000Z",
    });
    expect(overlap.status).toBe(409);
    const body = (await overlap.json()) as Record<string, unknown>;
    expect(body.error).toBe("CONFLICT");
    expect(String(body.message)).toMatch(/conflict/i);
  });

  it("no conflict — different room same time is allowed", async () => {
    const first = await createSessionViaApi({
      slug: "room-a-session",
      title: "Room A Session Title Here",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
    });
    expect(first.status).toBe(201);

    const second = await createSessionViaApi({
      slug: "room-b-session",
      title: "Room B Session Title Here",
      roomId: SECOND_ROOM_ID,
      startsAt: "2026-10-10T09:30:00.000Z",
      endsAt: "2026-10-10T10:30:00.000Z",
    });
    expect(second.status).toBe(201);
  });

  it("no conflict — same room non-overlapping adjacent times allowed (end exclusive)", async () => {
    const first = await createSessionViaApi({
      slug: "adjacent-first",
      title: "Adjacent First Session Title",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
    });
    expect(first.status).toBe(201);

    const adjacent = await createSessionViaApi({
      slug: "adjacent-second",
      title: "Adjacent Second Session Title",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T10:00:00.000Z",
      endsAt: "2026-10-10T11:00:00.000Z",
    });
    expect(adjacent.status).toBe(201);

    // Overlapping by 1 minute should conflict
    const overlap = await createSessionViaApi({
      slug: "adjacent-overlap",
      title: "Adjacent Overlap Session Title",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T09:59:00.000Z",
      endsAt: "2026-10-10T10:30:00.000Z",
    });
    expect(overlap.status).toBe(409);
  });

  it("update session overlapping time returns 409", async () => {
    const s1 = await createSessionViaApi({
      slug: "upd-first",
      title: "Updatable First Session Title",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
    });
    expect(s1.status).toBe(201);
    const s2 = await createSessionViaApi({
      slug: "upd-second",
      title: "Updatable Second Session Title",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T11:00:00.000Z",
      endsAt: "2026-10-10T12:00:00.000Z",
    });
    expect(s2.status).toBe(201);
    const id2 = ((await s2.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const sid2 = id2.id as string;

    const app = createApp({ db: db as never });
    const upd = await app.request(`/v1/admin/sessions/${sid2}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SESSIONS_WRITE },
      body: JSON.stringify({
        startsAt: "2026-10-10T09:30:00.000Z",
        endsAt: "2026-10-10T10:30:00.000Z",
      }),
    });
    expect(upd.status).toBe(409);
  });

  it("update session speakerIds transactionally replaces join", async () => {
    const payload = {
      slug: "speaker-join-test",
      title: "Speaker Join Test Session Title",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T13:00:00.000Z",
      endsAt: "2026-10-10T14:00:00.000Z",
      speakerIds: [speakerIdA],
    };
    const created = await createSessionViaApi(payload);
    expect(created.status).toBe(201);
    const id = ((await created.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const sid = id.id as string;

    // Check initial join count 1
    let count = (
      sqlite.prepare("SELECT count(*) as c FROM session_speakers WHERE session_id=?").get(sid) as {
        c: number;
      }
    ).c;
    expect(count).toBe(1);

    const app = createApp({ db: db as never });
    const upd = await app.request(`/v1/admin/sessions/${sid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SESSIONS_WRITE },
      body: JSON.stringify({ speakerIds: [speakerIdA, speakerIdB] }),
    });
    expect(upd.status).toBe(200);
    count = (
      sqlite.prepare("SELECT count(*) as c FROM session_speakers WHERE session_id=?").get(sid) as {
        c: number;
      }
    ).c;
    expect(count).toBe(2);

    // Clear speakers
    const clear = await app.request(`/v1/admin/sessions/${sid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SESSIONS_WRITE },
      body: JSON.stringify({ speakerIds: [] }),
    });
    expect(clear.status).toBe(200);
    count = (
      sqlite.prepare("SELECT count(*) as c FROM session_speakers WHERE session_id=?").get(sid) as {
        c: number;
      }
    ).c;
    expect(count).toBe(0);
  });

  it("room FK validation — unknown room returns 404", async () => {
    const res = await createSessionViaApi({
      slug: "bad-room",
      title: "Bad Room Session Title Here",
      roomId: "room_does_not_exist",
      startsAt: "2026-10-10T15:00:00.000Z",
      endsAt: "2026-10-10T16:00:00.000Z",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("NOT_FOUND");
  });

  it("speakerIds validation — unknown speaker returns 404", async () => {
    const res = await createSessionViaApi({
      slug: "bad-speaker",
      title: "Bad Speaker Session Title Here",
      speakerIds: ["speaker_does_not_exist"],
    });
    expect(res.status).toBe(404);
  });

  it("GET /v1/admin/schedule returns ordered sessions", async () => {
    const s1 = await createSessionViaApi({
      slug: "sched-late",
      title: "Sched Late Session Title",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T14:00:00.000Z",
      endsAt: "2026-10-10T15:00:00.000Z",
    });
    expect(s1.status).toBe(201);
    const s2 = await createSessionViaApi({
      slug: "sched-early",
      title: "Sched Early Session Title",
      roomId: ROOM_ID,
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
    });
    expect(s2.status).toBe(201);

    const app = createApp({ db: db as never });
    const res = await app.request("/v1/admin/schedule", {
      headers: { "X-Test-User": SESSIONS_READ },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data as Array<Record<string, unknown>>;
    expect(data.length).toBeGreaterThanOrEqual(2);
    // Order check — early before late if sorted
    const earlyIdx = data.findIndex((d) => d.slug === "sched-early");
    const lateIdx = data.findIndex((d) => d.slug === "sched-late");
    expect(earlyIdx).toBeLessThan(lateIdx);
  });

  it("supports epoch times overlap detection", async () => {
    const first = await createSessionViaApi({
      slug: "epoch-first",
      title: "Epoch First Session Title",
      roomId: ROOM_ID,
      startsAtEpoch: Math.floor(Date.parse("2026-10-10T09:00:00.000Z") / 1000),
      endsAtEpoch: Math.floor(Date.parse("2026-10-10T10:00:00.000Z") / 1000),
    });
    expect(first.status).toBe(201);

    const overlap = await createSessionViaApi({
      slug: "epoch-overlap",
      title: "Epoch Overlap Session Title",
      roomId: ROOM_ID,
      startsAtEpoch: Math.floor(Date.parse("2026-10-10T09:30:00.000Z") / 1000),
      endsAtEpoch: Math.floor(Date.parse("2026-10-10T10:30:00.000Z") / 1000),
    });
    expect(overlap.status).toBe(409);
  });

  it("alias routes /v1/sessions and /v1/rooms work with same RBAC", async () => {
    const app = createApp({ db: db as never });
    const listAlias = await app.request("/v1/sessions", {
      headers: { "X-Test-User": SESSIONS_READ },
    });
    expect(listAlias.status).toBe(200);
    const roomAlias = await app.request("/v1/rooms", { headers: { "X-Test-User": SESSIONS_READ } });
    expect(roomAlias.status).toBe(200);
    const createAlias = await app.request("/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": SESSIONS_WRITE },
      body: JSON.stringify({ slug: "alias-test", title: "Alias Test Session Title Here" }),
    });
    expect(createAlias.status).toBe(201);
  });
});

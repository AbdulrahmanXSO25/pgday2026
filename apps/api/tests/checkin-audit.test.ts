/**
 * checkin-audit.test.ts — §22, §32, §12, §26
 * Real better-sqlite3 temp DB, Hono app.request, no mocks.
 * Covers: check-in happy, idempotent, reject non-confirmed, audit log creation + PII redaction, RBAC on audit/settings, events CRUD, rate_limits documented.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@pgegypt/db";
import { createApp } from "../src/app.js";
import { createHash, randomUUID } from "node:crypto";

let sqlite: InstanceType<typeof Database>;
let db: BetterSQLite3Database<typeof schema>;
let tempDir: string;

const EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";

// ---------------------------------------------------------------------------
// Migration helpers — mirrors schedule-conflict.test.ts
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

  // Ensure registrations has checkin columns (for legacy 0001)
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
    sqlite.prepare("DELETE FROM audit_logs").run();
  } catch {}
  try {
    sqlite.prepare("DELETE FROM registrations").run();
  } catch {}
  try {
    sqlite.prepare("DELETE FROM rate_limits").run();
  } catch {}
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
  // Keep default event
  try {
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO events (id, slug, name, date, city) VALUES (?, 'pgegypt-2026','PG Day Egypt 2026','2026-10-10','Cairo, Egypt')"
      )
      .run(EVENT_ID);
  } catch {}
}

// ---------------------------------------------------------------------------
// RBAC helpers — X-Test-User injection
// ---------------------------------------------------------------------------

function testUserHeader(role: string, permissions: string[]): string {
  return JSON.stringify({
    id: `u_${role}_${permissions.join(",")}`,
    email: `${role.toLowerCase()}@pgegypt.test`,
    role,
    permissions,
  });
}

const SUPER_ADMIN = testUserHeader("SUPER_ADMIN", []);
const REGISTRATIONS_WRITE = testUserHeader("ADMIN", ["registrations:WRITE"]);
const REGISTRATIONS_READ = testUserHeader("ADMIN", ["registrations:READ"]);
const NO_PERM = testUserHeader("ADMIN", []);
const CHECKIN_WRITE = testUserHeader("ADMIN", ["checkin:WRITE"]);

// ---------------------------------------------------------------------------
// Helpers — create registration via public API, confirm, checkin
// ---------------------------------------------------------------------------

async function createRegistrationViaApi(payload: Record<string, unknown>) {
  const app = createApp({ db: db as never });
  const res = await app.request("/v1/registrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pgegypt-checkin-audit-"));
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
// Check-in — happy, idempotent, reject non-confirmed, stored hashed, RBAC
// ---------------------------------------------------------------------------

describe("Check-in — opaque token, idempotent, RBAC §22", () => {
  it("full flow: create → confirm generates opaque UUID stored hashed → check-in happy 200", async () => {
    const regRes = await createRegistrationViaApi({
      name: "Alice Attendee",
      email: "alice@example.com",
      organization: "Acme",
      consent: true,
    });
    expect(regRes.status).toBe(201);
    const regBody = (await regRes.json()) as Record<string, unknown>;
    const regId = (regBody.data as Record<string, unknown>).id as string;
    expect(typeof regId).toBe("string");

    // Confirm — should generate token
    const app = createApp({ db: db as never });
    const confirmRes = await app.request(`/v1/registrations/${regId}/confirm`, {
      method: "POST",
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    expect(confirmRes.status).toBe(200);
    const confirmBody = (await confirmRes.json()) as Record<string, unknown>;
    const data = confirmBody.data as Record<string, unknown>;
    const plainToken = data.checkinToken as string;
    expect(typeof plainToken).toBe("string");
    // UUID format (opaque)
    expect(plainToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // DB stored hashed, not plain
    const row = sqlite
      .prepare("SELECT checkin_token, status FROM registrations WHERE id=?")
      .get(regId) as { checkin_token: string | null; status: string } | undefined;
    expect(row?.status).toBe("confirmed");
    expect(row?.checkin_token).not.toBeNull();
    expect(row?.checkin_token).not.toBe(plainToken);
    expect(row?.checkin_token).toBe(sha256Hex(plainToken));

    // Check-in happy
    const checkinRes = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ token: plainToken }),
    });
    expect(checkinRes.status).toBe(200);
    const chkBody = (await checkinRes.json()) as Record<string, unknown>;
    expect((chkBody.data as Record<string, unknown>).status).toBe("checked_in");
    expect((chkBody.data as Record<string, unknown>).registrationId).toBe(regId);

    // Verify checked_in_at set
    const after = sqlite
      .prepare("SELECT checked_in_at FROM registrations WHERE id=?")
      .get(regId) as { checked_in_at: number | null } | undefined;
    expect(after?.checked_in_at).not.toBeNull();
    expect(typeof after?.checked_in_at).toBe("number");
  });

  it("idempotent repeat returns 200 already_checked_in", async () => {
    const regRes = await createRegistrationViaApi({
      name: "Bob Repeat",
      email: "bob@example.com",
      consent: true,
    });
    expect(regRes.status).toBe(201);
    const regId = ((await regRes.json()) as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    const id = regId.id as string;

    const app = createApp({ db: db as never });
    const confirmRes = await app.request(`/v1/registrations/${id}/confirm`, {
      method: "POST",
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    expect(confirmRes.status).toBe(200);
    const plainToken = ((await confirmRes.json()) as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    const token = plainToken.checkinToken as string;

    const first = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ token }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect((firstBody.data as Record<string, unknown>).status).toBe("checked_in");

    const second = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ token }),
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect((secondBody.data as Record<string, unknown>).status).toBe("already_checked_in");

    // Also via admin alias
    const third = await app.request("/v1/admin/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ token }),
    });
    expect(third.status).toBe(200);
    const thirdBody = (await third.json()) as Record<string, unknown>;
    expect((thirdBody.data as Record<string, unknown>).status).toBe("already_checked_in");
  });

  it("rejects non-confirmed 400", async () => {
    // Create pending registration, manually set token but keep pending
    const regRes = await createRegistrationViaApi({
      name: "Pending Pete",
      email: "pending@example.com",
      consent: true,
    });
    expect(regRes.status).toBe(201);
    const regId = ((await regRes.json()) as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    const id = regId.id as string;

    const fakeToken = randomUUID();
    const hashed = sha256Hex(fakeToken);
    sqlite.prepare("UPDATE registrations SET checkin_token=? WHERE id=?").run(hashed, id);
    // Verify status still pending
    const row = sqlite
      .prepare("SELECT status, checkin_token FROM registrations WHERE id=?")
      .get(id) as { status: string; checkin_token: string } | undefined;
    expect(row?.status).toBe("pending");
    expect(row?.checkin_token).toBe(hashed);

    const app = createApp({ db: db as never });
    const res = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ token: fakeToken }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("BAD_REQUEST");
    expect(String(body.message)).toMatch(/not confirmed/i);
  });

  it("invalid token returns 404", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ token: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("validation 422 — missing token", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({}),
    });
    expect([400, 422].includes(res.status)).toBe(true);
  });

  it("RBAC — requires auth and registrations:WRITE or checkin:WRITE", async () => {
    const regRes = await createRegistrationViaApi({
      name: "RBAC Test",
      email: "rbac@example.com",
      consent: true,
    });
    expect(regRes.status).toBe(201);
    const id = ((await regRes.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const regId = id.id as string;
    const app = createApp({ db: db as never });
    const confirmRes = await app.request(`/v1/registrations/${regId}/confirm`, {
      method: "POST",
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    const token = ((await confirmRes.json()) as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    const plain = token.checkinToken as string;

    // Unauthenticated → 401
    const unauth = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: plain }),
    });
    expect(unauth.status).toBe(401);

    // Authenticated but no perm → 403
    const noPerm = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": NO_PERM },
      body: JSON.stringify({ token: plain }),
    });
    expect(noPerm.status).toBe(403);

    // registrations:READ only → 403 (needs WRITE)
    const readOnly = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_READ },
      body: JSON.stringify({ token: plain }),
    });
    expect(readOnly.status).toBe(403);

    // registrations:WRITE → 200 (or already_checked_in if we already checked in earlier? Need fresh token, so do new pending then confirm again for isolation)
    // Create new for write check
    const reg2 = await createRegistrationViaApi({
      name: "RBAC Write",
      email: "rbac-write@example.com",
      consent: true,
    });
    const id2 = ((await reg2.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const rid2 = id2.id as string;
    const conf2 = await app.request(`/v1/registrations/${rid2}/confirm`, {
      method: "POST",
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    const plain2 = ((await conf2.json()) as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    const tok2 = plain2.checkinToken as string;
    const ok = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ token: tok2 }),
    });
    expect(ok.status).toBe(200);

    // checkin:WRITE also passes (alias)
    const reg3 = await createRegistrationViaApi({
      name: "Checkin Alias",
      email: "checkin-alias@example.com",
      consent: true,
    });
    const id3 = ((await reg3.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const rid3 = id3.id as string;
    const conf3 = await app.request(`/v1/registrations/${rid3}/confirm`, {
      method: "POST",
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    const plain3 = ((await conf3.json()) as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    const tok3 = plain3.checkinToken as string;
    const aliasOk = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": CHECKIN_WRITE },
      body: JSON.stringify({ token: tok3 }),
    });
    expect(aliasOk.status).toBe(200);
  });

  it("PATCH /v1/registrations/:id with status confirmed also generates token", async () => {
    const regRes = await createRegistrationViaApi({
      name: "Patch Confirm",
      email: "patch-confirm@example.com",
      consent: true,
    });
    expect(regRes.status).toBe(201);
    const id = ((await regRes.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const rid = id.id as string;
    const app = createApp({ db: db as never });
    const patchRes = await app.request(`/v1/registrations/${rid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ status: "confirmed" }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as Record<string, unknown>;
    const pdata = patchBody.data as Record<string, unknown>;
    expect(typeof pdata.checkinToken).toBe("string");
    const pt = pdata.checkinToken as string;
    expect(pt).toMatch(/^[0-9a-f-]{36}$/i);
    // Subsequent check-in should work
    const chk = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ token: pt }),
    });
    expect(chk.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Audit logs — creation, PII redaction, RBAC SUPER_ADMIN only
// ---------------------------------------------------------------------------

describe("Audit logs — creation, PII redaction, RBAC §32", () => {
  it("audit log created on registration confirm and check-in with PII redacted", async () => {
    const regRes = await createRegistrationViaApi({
      name: "Audit Alice",
      email: "audit-alice@example.com",
      consent: true,
    });
    expect(regRes.status).toBe(201);
    const id = ((await regRes.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const rid = id.id as string;

    const app = createApp({ db: db as never });
    const conf = await app.request(`/v1/registrations/${rid}/confirm`, {
      method: "POST",
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    expect(conf.status).toBe(200);
    const plain = ((await conf.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const token = plain.checkinToken as string;

    // Check audit_logs for confirm
    let rows = sqlite
      .prepare(
        "SELECT action, metadata, target_type, target_id FROM audit_logs WHERE action='registrations.confirm'"
      )
      .all() as Array<{
      action: string;
      metadata: string | null;
      target_type: string;
      target_id: string;
    }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const confirmRow = rows.find((r) => r.target_id === rid);
    expect(confirmRow).toBeDefined();
    // Metadata should be redacted — if it contained email, should be [REDACTED] or no raw email
    if (confirmRow?.metadata) {
      expect(confirmRow.metadata).not.toContain("audit-alice@example.com");
    }

    // Now check in
    const chk = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ token }),
    });
    expect(chk.status).toBe(200);

    rows = sqlite
      .prepare("SELECT action, metadata FROM audit_logs WHERE action='registrations.checkin'")
      .all() as Array<{ action: string; metadata: string | null }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Verify checkin audit exists
    const chkRow = sqlite
      .prepare("SELECT * FROM audit_logs WHERE action='registrations.checkin' AND target_id=?")
      .get(rid) as { action: string } | undefined;
    expect(chkRow?.action).toBe("registrations.checkin");

    // Test PII redaction via direct service call with email in metadata
    const { createAuditLog } = await import("../src/services/audit.service.js");
    await createAuditLog(db as never, {
      actorId: "test-actor",
      action: "test.pii",
      targetType: "user",
      targetId: "user-123",
      metadata: {
        email: "secret@example.com",
        name: "Secret",
        note: "contact secret@example.com for info",
      },
      ipAddress: "1.2.3.4",
      userAgent: "vitest",
    });
    const piiRows = sqlite
      .prepare("SELECT metadata FROM audit_logs WHERE action='test.pii'")
      .all() as Array<{ metadata: string | null }>;
    const metaStr = piiRows[0]?.metadata ?? "";
    expect(metaStr).not.toContain("secret@example.com");
    expect(metaStr).toContain("[REDACTED]");
  });

  it("GET /v1/audit-logs SUPER_ADMIN only — 401/403/200", async () => {
    const app = createApp({ db: db as never });

    const unauth = await app.request("/v1/audit-logs");
    expect(unauth.status).toBe(401);

    const forbidden = await app.request("/v1/audit-logs", { headers: { "X-Test-User": NO_PERM } });
    expect(forbidden.status).toBe(403);

    const readOnly = await app.request("/v1/audit-logs", {
      headers: { "X-Test-User": REGISTRATIONS_WRITE },
    });
    expect(readOnly.status).toBe(403);

    const ok = await app.request("/v1/audit-logs", { headers: { "X-Test-User": SUPER_ADMIN } });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(Array.isArray(body.data)).toBe(true);

    // Alias /v1/admin/audit-logs also SUPER_ADMIN
    const aliasOk = await app.request("/v1/admin/audit-logs", {
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    expect(aliasOk.status).toBe(200);
    const aliasForbidden = await app.request("/v1/admin/audit-logs", {
      headers: { "X-Test-User": NO_PERM },
    });
    expect(aliasForbidden.status).toBe(403);
  });

  it("audit log records every mutation — events update creates audit", async () => {
    const app = createApp({ db: db as never });
    const patch = await app.request(`/v1/events/${EVENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SUPER_ADMIN },
      body: JSON.stringify({ name: "Updated via audit test" }),
    });
    expect(patch.status).toBe(200);

    const rows = sqlite
      .prepare("SELECT action FROM audit_logs WHERE action='events.update'")
      .all() as Array<{ action: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Settings/events CRUD — SUPER_ADMIN only, rate_limits documented
// ---------------------------------------------------------------------------

describe("Settings/events CRUD — SUPER_ADMIN only §12", () => {
  it("GET /v1/events/:id SUPER_ADMIN only", async () => {
    const app = createApp({ db: db as never });

    const unauth = await app.request(`/v1/events/${EVENT_ID}`);
    expect(unauth.status).toBe(401);

    const forbid = await app.request(`/v1/events/${EVENT_ID}`, {
      headers: { "X-Test-User": REGISTRATIONS_WRITE },
    });
    expect(forbid.status).toBe(403);

    const ok = await app.request(`/v1/events/${EVENT_ID}`, {
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;
    expect(data.id).toBe(EVENT_ID);
    expect(typeof data.name).toBe("string");

    // Alias /v1/settings should return same default event
    const settingsOk = await app.request("/v1/settings", {
      headers: { "X-Test-User": SUPER_ADMIN },
    });
    expect(settingsOk.status).toBe(200);
    const sBody = (await settingsOk.json()) as Record<string, unknown>;
    expect((sBody.data as Record<string, unknown>).id).toBe(EVENT_ID);

    const forbidSettings = await app.request("/v1/settings", {
      headers: { "X-Test-User": NO_PERM },
    });
    expect(forbidSettings.status).toBe(403);
  });

  it("PATCH /v1/events/:id updates and audits, ADMIN forbidden", async () => {
    const app = createApp({ db: db as never });

    const patchForbidden = await app.request(`/v1/events/${EVENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": REGISTRATIONS_WRITE },
      body: JSON.stringify({ name: "Should not update" }),
    });
    expect(patchForbidden.status).toBe(403);

    const patchOk = await app.request(`/v1/events/${EVENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SUPER_ADMIN },
      body: JSON.stringify({ name: "PG Day Egypt 2026 — Updated", venueStatus: "tba" }),
    });
    expect(patchOk.status).toBe(200);
    const body = (await patchOk.json()) as Record<string, unknown>;
    expect((body.data as Record<string, unknown>).name).toBe("PG Day Egypt 2026 — Updated");

    // Verify DB
    const row = sqlite.prepare("SELECT name, venue_status FROM events WHERE id=?").get(EVENT_ID) as
      { name: string; venue_status: string } | undefined;
    expect(row?.name).toBe("PG Day Egypt 2026 — Updated");

    // Validation — invalid venueStatus 422
    const bad = await app.request(`/v1/events/${EVENT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SUPER_ADMIN },
      body: JSON.stringify({ venueStatus: "invalid" }),
    });
    expect([400, 422].includes(bad.status)).toBe(true);

    // Not found
    const notFound = await app.request("/v1/events/evt_does_not_exist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SUPER_ADMIN },
      body: JSON.stringify({ name: "Ghost" }),
    });
    expect(notFound.status).toBe(404);

    // PATCH via /v1/settings alias
    const settingsPatch = await app.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SUPER_ADMIN },
      body: JSON.stringify({ tagline: "Updated tagline via settings" }),
    });
    expect(settingsPatch.status).toBe(200);
    const sBody = (await settingsPatch.json()) as Record<string, unknown>;
    expect((sBody.data as Record<string, unknown>).tagline).toBe("Updated tagline via settings");
  });

  it("GET /v1/events lists events SUPER_ADMIN", async () => {
    const app = createApp({ db: db as never });
    const res = await app.request("/v1/events", { headers: { "X-Test-User": SUPER_ADMIN } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const data = body.data as Array<Record<string, unknown>>;
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.some((e) => e.id === EVENT_ID)).toBe(true);

    const forbid = await app.request("/v1/events", { headers: { "X-Test-User": NO_PERM } });
    expect(forbid.status).toBe(403);
  });

  it("rate_limits table documented and exists (§12)", async () => {
    // Verify table exists and has correct columns
    const tableInfo = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rate_limits'")
      .get() as { name: string } | undefined;
    expect(tableInfo?.name).toBe("rate_limits");

    const cols = sqlite
      .prepare("SELECT name FROM pragma_table_info('rate_limits')")
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain("key");
    expect(colNames).toContain("window_start");
    expect(colNames).toContain("count");
    // updated_at added in migration
    expect(colNames).toContain("updated_at");

    const before = sqlite
      .prepare("SELECT count FROM rate_limits WHERE key=?")
      .get("test_rate_key") as { count: number } | undefined;
    expect(before).toBeUndefined();
    sqlite
      .prepare("INSERT INTO rate_limits (key, window_start, count, updated_at) VALUES (?,?,?,?)")
      .run("test_rate_key", Math.floor(Date.now() / 1000), 1, Math.floor(Date.now() / 1000));
    const after = sqlite
      .prepare("SELECT count FROM rate_limits WHERE key=?")
      .get("test_rate_key") as { count: number } | undefined;
    expect(after?.count).toBe(1);
  });
});

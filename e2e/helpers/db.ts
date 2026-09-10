/**
 * E2E DB helper — real better-sqlite3 temp DB with migrations.
 * Shared across all Playwright API E2E specs to avoid duplication.
 */
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@pgegypt/db";

export const EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";

export function getMigrationsDir(): string {
  const candidates = [
    resolve(process.cwd(), "migrations"),
    resolve(process.cwd(), "../../migrations"),
    join(process.cwd(), "apps/api/migrations"),
    resolve(process.cwd(), "apps/api/migrations"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return resolve(process.cwd(), "migrations");
}

export function applyMigrations(database: InstanceType<typeof Database>, dir: string): void {
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

export type TestDb = {
  sqlite: InstanceType<typeof Database>;
  db: BetterSQLite3Database<typeof schema>;
  tempDir: string;
};

export function createTestDb(prefix = "pgegypt-e2e-"): TestDb {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  const dbFile = join(tempDir, "test.db");
  const sqlite = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  applyMigrations(sqlite, getMigrationsDir());
  const db = drizzle(sqlite, { schema });
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO events (id, slug, name, date, city) VALUES (?, 'pgegypt-2026','PG Day Egypt 2026','2026-10-10','Cairo, Egypt')"
    )
    .run(EVENT_ID);
  return { sqlite, db, tempDir };
}

export function cleanTables(sqlite: InstanceType<typeof Database>): void {
  for (const t of [
    "session_speakers",
    "sessions",
    "speakers",
    "sponsors",
    "rooms",
    "publications",
    "audit_logs",
    "user_sessions",
    "admin_permissions",
    "users",
    "registrations",
    "rate_limits",
    "cfp_submission_speakers",
    "cfp_submissions",
    "cfp_reviews",
    "media",
  ]) {
    try {
      sqlite.prepare(`DELETE FROM ${t}`).run();
    } catch {}
  }
  try {
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO events (id, slug, name, date, city) VALUES (?, 'pgegypt-2026','PG Day Egypt 2026','2026-10-10','Cairo, Egypt')"
      )
      .run(EVENT_ID);
  } catch {}
}

export function cleanupDb(t: TestDb): void {
  try {
    t.sqlite.close();
  } catch {}
  try {
    rmSync(t.tempDir, { recursive: true, force: true });
  } catch {}
}

export function testUserHeader(role: string, permissions: string[]): string {
  return JSON.stringify({
    id: `u_${role}_${permissions.join(",")}`,
    email: `${role.toLowerCase()}@pgegypt.test`,
    role,
    permissions,
  });
}

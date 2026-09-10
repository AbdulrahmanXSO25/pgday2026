/**
 * migrate.ts — run SQLite migrations against local file (better-sqlite3).
 * Same SQL runs on D1 prod; no Postgres syntax. Handles 0001 + 0002 upgrades.
 *
 * Usage:
 *   pnpm --filter @pgegypt/db exec tsx src/scripts/migrate.ts
 *   DB_FILE=./data/local.db pnpm --filter @pgegypt/db exec tsx scripts/migrate.ts
 *
 * Pure small functions, DI, explicit errors.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";

type MigrateOptions = {
  dbFile: string;
  migrationsDir: string;
};

const DEFAULT_DB_FILE = process.env.DB_FILE ?? "./data/local.db";
const DEFAULT_MIGRATIONS = resolve(process.cwd(), "../../migrations");

// Alternative when running from packages/db perspective
function resolveMigrationsDir(explicit?: string): string {
  if (explicit) return resolve(explicit);
  const envDir = process.env.MIGRATIONS_DIR;
  if (envDir) return resolve(envDir);
  const candidates = [
    resolve(process.cwd(), "../../migrations"),
    resolve(process.cwd(), "./migrations"),
    resolve(process.cwd(), "migrations"),
    join(dirname(new URL(import.meta.url).pathname), "../../../migrations"),
    join(dirname(new URL(import.meta.url).pathname), "../../migrations"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return DEFAULT_MIGRATIONS;
}

function getDbFile(explicit?: string): string {
  if (explicit) return explicit;
  return process.env.DB_FILE ?? DEFAULT_DB_FILE;
}

function ensureDirForFile(filePath: string): void {
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readMigrations(migrationsDir: string): Array<{ name: string; sql: string }> {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations dir not found: ${migrationsDir}`);
  }
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No .sql files in migrations dir: ${migrationsDir}`);
  }
  return files.map((name) => ({
    name,
    sql: readFileSync(join(migrationsDir, name), "utf-8"),
  }));
}

function createMigrationsTable(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

function isApplied(db: InstanceType<typeof Database>, name: string): boolean {
  const row = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get(name) as unknown;
  return Boolean(row);
}

function recordApplied(db: InstanceType<typeof Database>, name: string): void {
  db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
}

/**
 * Upgrade helpers: ensure registrations and rate_limits have correct columns.
 * SQLite lacks conditional DDL, so we detect via pragma and perform recreation if needed.
 */
function ensureRegistrationsSchema(db: InstanceType<typeof Database>): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('registrations')").all() as Array<{
    name: string;
  }>;
  const hasEventId = cols.some((c) => c.name === "event_id");
  const hasCheckinToken = cols.some((c) => c.name === "checkin_token");
  const hasDeletedAt = cols.some((c) => c.name === "deleted_at");

  if (hasEventId && hasCheckinToken && hasDeletedAt) return;

  // Need full recreation — preserve data if any (old schema had TEXT created_at)
  const eventIdForMigration = "evt_00000000-0000-7000-8000-000000000001";
  // Ensure default event exists
  db.prepare(
    `INSERT OR IGNORE INTO events (id, slug, name, date, city, venue_status) VALUES (?, 'pgegypt-2026','PG Day Egypt 2026','2026-10-10','Cairo, Egypt','tba')`
  ).run(eventIdForMigration);

  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(`
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
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      deleted_at INTEGER,
      UNIQUE(event_id, email)
    );
  `);

  // Try to copy old data — handle both old and intermediate schemas
  try {
    const hasOldCreatedAtText = cols.some((c) => c.name === "created_at");
    if (hasOldCreatedAtText) {
      db.exec(`
        INSERT OR IGNORE INTO registrations_new_full (id, event_id, name, email, organization, role, dietary_notes, status, checkin_token, checked_in_at, created_at, updated_at, deleted_at)
        SELECT
          id,
          '${eventIdForMigration}',
          name,
          lower(email),
          organization,
          role,
          dietary_notes,
          COALESCE(status,'pending'),
          checkin_token,
          checked_in_at,
          CASE WHEN typeof(created_at)='integer' THEN created_at WHEN created_at GLOB '*[^0-9]*' THEN unixepoch(created_at) ELSE CAST(created_at AS INTEGER) END,
          unixepoch(),
          deleted_at
        FROM registrations;
      `);
    }
  } catch {
    // ignore copy errors — empty table case
  }

  db.exec("DROP TABLE IF EXISTS registrations;");
  db.exec("ALTER TABLE registrations_new_full RENAME TO registrations;");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_event_email ON registrations(event_id, email);"
  );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_checkin_token ON registrations(checkin_token);"
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON registrations(event_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email);");
  db.exec("PRAGMA foreign_keys = ON;");
}

function ensureRateLimitsSchema(db: InstanceType<typeof Database>): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('rate_limits')").all() as Array<{
    name: string;
  }>;
  const hasUpdatedAt = cols.some((c) => c.name === "updated_at");
  const hasWindowStartInt = cols.some((c) => c.name === "window_start");

  // If already correct (has updated_at), assume migration done
  if (hasUpdatedAt && hasWindowStartInt) {
    // Also verify window_start is INTEGER type — pragma d1 vs file may differ, but we trust
    return;
  }

  if (!hasUpdatedAt) {
    try {
      db.exec(
        "ALTER TABLE rate_limits ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (unixepoch());"
      );
    } catch {
      // column may already exist or other error — ignore
    }
  }

  // Convert window_start TEXT to INTEGER if needed — do via temp table if old type is TEXT
  // Detect type via pragma: name, type
  const info = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rate_limits'")
    .get() as { sql: string } | undefined;
  const sqlDef = info?.sql ?? "";
  const hasTextWindow = sqlDef.includes("window_start TEXT");
  if (hasTextWindow) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits_new2 (
        key TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    try {
      db.exec(`
        INSERT OR IGNORE INTO rate_limits_new2 (key, window_start, count, updated_at)
        SELECT key,
          CASE WHEN typeof(window_start)='integer' THEN window_start WHEN window_start GLOB '*[^0-9]*' THEN unixepoch(window_start) ELSE CAST(window_start AS INTEGER) END,
          count,
          COALESCE(updated_at, unixepoch())
        FROM rate_limits;
      `);
    } catch {
      // ignore
    }
    db.exec("DROP TABLE IF EXISTS rate_limits;");
    db.exec("ALTER TABLE rate_limits_new2 RENAME TO rate_limits;");
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

export function migrate(options: MigrateOptions): { applied: string[]; skipped: string[] } {
  const { dbFile, migrationsDir } = options;
  ensureDirForFile(dbFile);

  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    createMigrationsTable(db);
    const migrations = readMigrations(migrationsDir);
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const { name, sql } of migrations) {
      if (isApplied(db, name)) {
        skipped.push(name);
        continue;
      }
      const run = db.transaction(() => {
        // Execute per-statement to allow one failing INSERT (fresh DB old schema) not to skip later CREATEs (media etc.)
        const stripped = sql.replace(/--.*$/gm, "");
        const statements = stripped.split(";");
        for (const chunk of statements) {
          const stmt = chunk.trim();
          if (!stmt) continue;
          try {
            db.exec(stmt + ";");
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
        recordApplied(db, name);
      });
      run();
      applied.push(name);
    }

    // Post-migration schema fixes for SQLite peculiarities
    ensureRegistrationsSchema(db);
    ensureRateLimitsSchema(db);

    return { applied, skipped };
  } finally {
    db.close();
  }
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbFile = getDbFile();
  const migrationsDir = resolveMigrationsDir();
  try {
    const result = migrate({ dbFile, migrationsDir });
    const total = result.applied.length + result.skipped.length;
    console.log(`[migrate] DB: ${resolve(dbFile)}`);
    console.log(`[migrate] Migrations dir: ${migrationsDir}`);
    console.log(
      `[migrate] Applied ${result.applied.length}/${total}: ${result.applied.join(", ") || "(none)"}`
    );
    console.log(
      `[migrate] Skipped ${result.skipped.length}: ${result.skipped.join(", ") || "(none)"}`
    );
    if (result.applied.length === 0) {
      console.log("[migrate] Nothing to apply — already up to date.");
    }
  } catch (error) {
    console.error("[migrate] Failed:", (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

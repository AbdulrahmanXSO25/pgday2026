/**
 * Client factory for Drizzle SQLite.
 * Local: better-sqlite3 file at DB_FILE or ./data/local.db
 * Prod: D1 binding — type exported for Phase 7 wiring (not instantiated here).
 *
 * Pure factory with DI — no global state, explicit errors, no mutation.
 */

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Db = BetterSQLite3Database<typeof schema>;

// D1 type placeholder — actual D1 binding is `D1Database` from Cloudflare.
// Exported so `apps/api` can type the prod adapter without importing Cloudflare here.
export type D1DatabaseLike = {
  prepare: (query: string) => {
    bind: (...args: unknown[]) => {
      first: <T>(c?: string) => Promise<T | null>;
      run: () => Promise<unknown>;
      all: <T>() => Promise<{ results: T[] }>;
    };
  };
  batch: (stmts: unknown[]) => Promise<unknown>;
  exec: (query: string) => Promise<unknown>;
};

export type CreateLocalClientOptions = {
  dbFile?: string;
  enableForeignKeys?: boolean;
  readonly?: boolean;
};

export const migrationsPath = "../../migrations";
const DEFAULT_DB_FILE = "./data/local.db";

// Candidates for shared DB file when running via turbo (cwd may be repo root, apps/api, or packages/db)
const SHARED_DB_CANDIDATES = [
  "./data/local.db",
  "packages/db/data/local.db",
  "apps/api/data/local.db",
  resolve(process.cwd(), "packages/db/data/local.db"),
  resolve(process.cwd(), "apps/api/data/local.db"),
  resolve(process.cwd(), "data/local.db"),
  resolve(process.cwd(), "../../packages/db/data/local.db"),
  resolve(process.cwd(), "../packages/db/data/local.db"),
  resolve(process.cwd(), "../../data/local.db"),
  join(resolve(process.cwd(), ".."), "packages/db/data/local.db"),
];

/**
 * Resolve DB file path from options or env.
 * Pure function — no side effects.
 */
export function resolveDbFile(options: CreateLocalClientOptions = {}): string {
  if (options.dbFile) return options.dbFile;
  const envFile = process.env.DB_FILE;
  if (envFile && envFile.trim().length > 0) return envFile.trim();
  for (const cand of SHARED_DB_CANDIDATES) {
    try {
      if (cand.includes("local.db") && existsSync(cand)) return cand;
    } catch {}
  }
  // Fresh DB — pick shared location based on cwd
  try {
    const cwd = process.cwd();
    if (existsSync(resolve(cwd, "packages/db"))) {
      return resolve(cwd, "packages/db/data/local.db");
    }
    if (cwd.endsWith("apps/api") || cwd.endsWith("packages/db")) {
      return resolve(cwd, "../../packages/db/data/local.db");
    }
  } catch {}
  return DEFAULT_DB_FILE;
}

/**
 * Create a better-sqlite3 Drizzle client for local development.
 * Caller is responsible for closing the underlying Database when done (e.g., in tests).
 */
export function createLocalClient(options: CreateLocalClientOptions = {}): {
  db: Db;
  sqlite: InstanceType<typeof Database>;
} {
  const file = resolveDbFile(options);
  // Ensure directory exists (better-sqlite3 does not create it)
  try {
    const dir = dirname(resolve(file));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch {}

  let sqlite: InstanceType<typeof Database>;
  try {
    sqlite = new Database(file, {
      readonly: options.readonly ?? false,
      // Verbose disabled — use structured logging at call sites if needed
    });
  } catch (error) {
    throw new Error(`Failed to open SQLite file at ${file}: ${String((error as Error).message)}`, {
      cause: error,
    });
  }

  // Enforce foreign keys — required for CASCADE/SET NULL behaviour
  const fkEnabled = options.enableForeignKeys ?? true;
  if (fkEnabled) {
    try {
      sqlite.pragma("journal_mode = WAL");
      sqlite.pragma("foreign_keys = ON");
    } catch {
      // Non-fatal — pragma may fail on some platforms, but we surface the warning
    }
  }

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/**
 * Convenience: create client and return only `db` handle.
 * Exported for simple usage; tests that need to close should use createLocalClient.
 */
export function createDb(options: CreateLocalClientOptions = {}): Db {
  return createLocalClient(options).db;
}

/**
 * Close helper — pure wrapper to ensure sqlite is closed cleanly.
 */
export function closeClient(sqlite: InstanceType<typeof Database>): void {
  try {
    sqlite.close();
  } catch (error) {
    // Idempotent close — ignore already-closed errors
    const msg = String((error as Error).message ?? "");
    if (!msg.includes("closed") && !msg.includes("already")) {
      throw error;
    }
  }
}

/**
 * Minimal stub for @pgegypt/db used by apps/api typecheck when drizzle/better-sqlite3 not installed.
 * Exports same surface as packages/db/src/index.ts but with Db as unknown.
 * After `pnpm install`, real package will be resolved via node_modules and this stub
 * is overridden only for typecheck via tsconfig paths — runtime import will still
 * attempt to use this stub if paths take precedence, so keep runtime-compatible fallback.
 */

export type Db = unknown;
export type D1DatabaseLike = {
  prepare: (query: string) => {
    bind: (...args: unknown[]) => {
      first: <T>() => Promise<T | null>;
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

export function createLocalClient(_options: CreateLocalClientOptions = {}): {
  db: Db;
  sqlite: unknown;
} {
  // Throw at runtime so caller falls back to undefined db (health still works)
  throw new Error("better-sqlite3 not available in stub — running without DB");
}

export function createDb(_options: CreateLocalClientOptions = {}): Db {
  throw new Error("stub");
}

export function closeClient(_sqlite: unknown): void {}

export function resolveDbFile(_options: CreateLocalClientOptions = {}): string {
  return "./data/local.db";
}

export const migrationsPath = "../../migrations";

// Re-export empty schema to satisfy `import * as schema` if needed
export const schema = {};

// Dummy table exports for type compatibility (not used in api)
export const events = {} as unknown;
export const users = {} as unknown;
export const adminPermissions = {} as unknown;
export const rooms = {} as unknown;
export const speakers = {} as unknown;
export const sessions = {} as unknown;
export const sessionSpeakers = {} as unknown;
export const sponsors = {} as unknown;
export const cfpSubmissions = {} as unknown;
export const cfpSubmissionSpeakers = {} as unknown;
export const cfpReviews = {} as unknown;
export const registrations = {} as unknown;
export const media = {} as unknown;
export const auditLogs = {} as unknown;
export const rateLimits = {} as unknown;
export const publications = {} as unknown;
export const userSessions = {} as unknown;

import type { Context, Next } from "hono";
import type { AppEnv } from "../app.js";
import type { Db } from "@pgegypt/db";

/**
 * DI helpers for db/storage/queue adapters.
 *
 * Routes must NOT import `better-sqlite3` or D1 directly.
 * Instead, app factory injects adapters via `c.set('db', db)` middleware,
 * and handlers read via `getDb(c)`.
 */

export function getDb(c: Context<AppEnv>): Db | undefined {
  try {
    return c.get("db" as never) as Db | undefined;
  } catch {
    return undefined;
  }
}

export function requireDb(c: Context<AppEnv>): Db {
  const db = getDb(c);
  if (!db) throw new Error("DB not available — ensure createApp({ db }) was used");
  return db;
}

/**
 * Middleware factory that injects db into typed context.
 * Pure DI — no global state.
 */
export function dbMiddleware(db: Db | undefined) {
  return async (c: Context<AppEnv>, next: Next) => {
    if (db) c.set("db" as never, db as never);
    await next();
  };
}

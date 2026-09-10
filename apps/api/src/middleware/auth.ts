import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { eq, and, isNull } from "drizzle-orm";
import { users, adminPermissions, userSessions } from "@pgegypt/db";
import type { Db } from "@pgegypt/db";
import type { AppEnv } from "../app.js";
import {
  SESSION_COOKIE,
  allPermissionsForSuperAdmin,
  type Role,
  type Permission,
} from "@pgegypt/auth";
import { hashTokenSync } from "@pgegypt/auth";
import { ApiError } from "./errorHandler.js";
import { getDb } from "../lib/db.js";

export type AuthUser = {
  id: string;
  email: string;
  displayName?: string;
  role: Role;
  permissions: Permission[];
};

// ---------------------------------------------------------------------------
// Helpers — Drizzle-agnostic (better-sqlite3 sync vs D1 async)
// ---------------------------------------------------------------------------

async function selectAll(query: unknown): Promise<unknown[]> {
  const q = query as Record<string, unknown>;
  if (typeof q.all === "function") {
    const res = (q.all as () => unknown)();
    const awaited = res instanceof Promise ? await res : res;
    if (Array.isArray(awaited)) return awaited;
    if (
      awaited &&
      typeof awaited === "object" &&
      "results" in (awaited as Record<string, unknown>)
    ) {
      return ((awaited as Record<string, unknown>).results as unknown[]) ?? [];
    }
    return Array.isArray(awaited) ? awaited : [];
  }
  const res = await (query as Promise<unknown>);
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && "results" in (res as Record<string, unknown>)) {
    return ((res as Record<string, unknown>).results as unknown[]) ?? [];
  }
  return [];
}

async function runQuery(query: unknown): Promise<void> {
  const q = query as Record<string, unknown>;
  if (typeof q.run === "function") {
    const res = (q.run as () => unknown)();
    if (res instanceof Promise) await res;
    return;
  }
  await (query as Promise<unknown>);
}

function toPermissionStrings(
  rows: Array<{ module: string; canRead: number; canWrite: number }>
): Permission[] {
  const out: Permission[] = [];
  for (const r of rows) {
    if (r.canRead) out.push(`${r.module}:READ` as Permission);
    if (r.canWrite) out.push(`${r.module}:WRITE` as Permission);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const db = getDb(c) as Db | undefined;
    // Test injection — X-Test-User header is honored in NON-PRODUCTION runtimes only.
    // In production this header must never be trusted (it would be a full auth bypass).
    const runtime =
      (c.get("runtime" as never) as string | undefined) ??
      (c.env as { RUNTIME?: string } | undefined)?.RUNTIME ??
      (typeof process !== "undefined" ? (process.env.RUNTIME ?? process.env.NODE_ENV) : undefined);
    const isProd = runtime === "production" || process.env.NODE_ENV === "production";
    const testUserHeader = isProd ? undefined : c.req.header("x-test-user");
    if (testUserHeader) {
      try {
        const parsed = JSON.parse(testUserHeader) as AuthUser;
        if (parsed && typeof parsed.id === "string" && typeof parsed.role === "string") {
          // Ensure test user exists in DB so FKs (audit_logs, cfp_reviews, media, etc.) don't fail
          if (db) {
            try {
              const now = Math.floor(Date.now() / 1000);
              const { users } = await import("@pgegypt/db");
              // Use raw SQL to avoid Drizzle import cycles in middleware
              // Try Drizzle insert, fallback to raw
              try {
                await (
                  db as unknown as {
                    insert: (t: unknown) => {
                      values: (v: unknown) => { onConflictDoNothing: () => unknown };
                    };
                  }
                )
                  .insert(users)
                  .values({
                    id: parsed.id,
                    email: parsed.email ?? `${parsed.id}@test.local`,
                    passwordHash: "test-hash-not-used",
                    displayName: parsed.email ?? parsed.id,
                    role: parsed.role,
                    createdAt: now,
                    updatedAt: now,
                  } as never)
                  .onConflictDoNothing();
              } catch {
                // Fallback raw
                try {
                  (
                    db as unknown as {
                      prepare: (s: string) => { run: (...a: unknown[]) => unknown };
                    }
                  )
                    .prepare(
                      "INSERT OR IGNORE INTO users (id, email, password_hash, display_name, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)"
                    )
                    .run(
                      parsed.id,
                      parsed.email ?? `${parsed.id}@test.local`,
                      "test-hash",
                      parsed.email ?? parsed.id,
                      parsed.role,
                      now,
                      now
                    );
                } catch {
                  // ignore
                }
              }
            } catch {
              // ignore
            }
          }
          c.set("user" as never, parsed as never);
          await next();
          return;
        }
      } catch {
        // ignore malformed
      }
    }

    if (!db) {
      c.set("user" as never, undefined as never);
      await next();
      return;
    }

    // Extract token from cookie or Authorization header
    let rawToken: string | undefined = getCookie(c, SESSION_COOKIE);
    if (!rawToken) {
      const auth = c.req.header("authorization");
      if (auth?.startsWith("Bearer ")) rawToken = auth.slice(7).trim() || undefined;
    }
    if (!rawToken) {
      c.set("user" as never, undefined as never);
      await next();
      return;
    }

    let tokenHash: string;
    try {
      tokenHash = hashTokenSync(rawToken);
    } catch {
      c.set("user" as never, undefined as never);
      await next();
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);

    // Lookup session
    const sessionRows = await selectAll(
      db.select().from(userSessions).where(eq(userSessions.tokenHash, tokenHash))
    );
    const session = (sessionRows[0] as typeof userSessions.$inferSelect) ?? null;
    if (!session) {
      c.set("user" as never, undefined as never);
      await next();
      return;
    }

    // Expiry check — delete expired and treat as unauth
    if ((session.expiresAt as number) <= nowSec) {
      try {
        await runQuery(db.delete(userSessions).where(eq(userSessions.tokenHash, tokenHash)));
      } catch {
        // ignore cleanup failure
      }
      c.set("user" as never, undefined as never);
      await next();
      return;
    }

    // Load user
    const userRows = await selectAll(
      db
        .select()
        .from(users)
        .where(and(eq(users.id, session.userId), isNull(users.deletedAt)))
    );
    const user = (userRows[0] as typeof users.$inferSelect) ?? null;
    if (!user) {
      c.set("user" as never, undefined as never);
      await next();
      return;
    }
    // §14.3 — disabled users are immediately revoked
    if ((user.status as string | undefined) === "disabled") {
      c.set("user" as never, undefined as never);
      await next();
      return;
    }

    // Load permissions
    let permissions: Permission[];
    if ((user.role as Role) === "SUPER_ADMIN") {
      permissions = allPermissionsForSuperAdmin();
    } else {
      const permRows = await selectAll(
        db.select().from(adminPermissions).where(eq(adminPermissions.userId, user.id))
      );
      permissions = toPermissionStrings(
        permRows as Array<{ module: string; canRead: number; canWrite: number }>
      );
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? undefined,
      role: user.role as Role,
      permissions,
    };

    c.set("user" as never, authUser as never);
    await next();
  };
}

export function requireAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user" as never) as AuthUser | undefined;
    if (!user) {
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    }
    await next();
  };
}

export function optionalAuth(): MiddlewareHandler<AppEnv> {
  return authMiddleware();
}

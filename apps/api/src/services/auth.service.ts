import type { Db } from "@pgegypt/db";
import { eq, and, isNull } from "drizzle-orm";
import { users, adminPermissions, userSessions, auditLogs } from "@pgegypt/db";
import { hashPassword, verifyPassword } from "@pgegypt/auth";
import { generateSessionToken, hashTokenSync, SESSION_TTL_SECONDS } from "@pgegypt/auth";
import { ApiError } from "../middleware/errorHandler.js";
import {
  MODULES,
  allPermissionsForSuperAdmin,
  normalizePermissionRow,
  type Module,
  type Permission,
  type Role,
} from "@pgegypt/auth";

// ---------------------------------------------------------------------------
// Helpers — pure small functions
// ---------------------------------------------------------------------------

function nowSec(now?: number): number {
  return Math.floor((now ?? Date.now()) / 1000);
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

async function createAuditLogEntry(
  db: Db,
  input: {
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    metadata: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  try {
    const id = crypto.randomUUID();
    await runQuery(
      db.insert(auditLogs).values({
        id,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: JSON.stringify(input.metadata ?? {}),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        createdAt: nowSec(),
      } as never)
    );
  } catch {
    // audit failure must not fail the mutation
  }
}

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

async function selectOne<T>(query: unknown): Promise<T | null> {
  const q = query as Record<string, unknown>;
  if (typeof q.get === "function") {
    const res = (q.get as () => unknown)();
    const awaited = res instanceof Promise ? await res : res;
    return (awaited as T) ?? null;
  }
  const all = await selectAll(query);
  return (all[0] as T) ?? null;
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoginInput = { email: string; password: string };
export type CreateUserInput = {
  email: string;
  password: string;
  displayName: string;
  role?: Role;
  permissions?: Array<{ module: Module; canRead?: boolean | number; canWrite?: boolean | number }>;
};

// ---------------------------------------------------------------------------
// Core service — DI via db param, explicit errors, no globals
// ---------------------------------------------------------------------------

/**
 * Authenticate by email/password, create session, audit log.
 * Returns token + user payload.
 */
export async function login(
  db: Db,
  input: LoginInput,
  meta: { ip?: string; userAgent?: string; now?: number } = {}
): Promise<{
  token: string;
  expiresAt: number;
  user: { id: string; email: string; displayName: string; role: Role; permissions: Permission[] };
}> {
  const email = input.email.trim().toLowerCase();
  // Trim surrounding whitespace (paste/autofill safety); internal characters stay exact
  const password = input.password.trim();

  if (!email || !password) throw new ApiError(400, "BAD_REQUEST", "Email and password required");

  // Find user (not soft-deleted)
  const query = db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));
  const rows = await selectAll(query);
  const user = (rows[0] as typeof users.$inferSelect) ?? null;

  if (!user) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid email or password");
  }

  // §14.3 — disabled users cannot log in (immediate revocation)
  if ((user.status as string | undefined) === "disabled") {
    throw new ApiError(401, "UNAUTHORIZED", "Account disabled");
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid email or password");
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

  // Create session
  const token = generateSessionToken();
  let tokenHash: string;
  try {
    tokenHash = hashTokenSync(token);
  } catch {
    // Fallback — should not happen in Node, but wrap
    tokenHash = token.slice(0, 32);
  }
  const created = nowSec(meta.now);
  const expiresAt = created + SESSION_TTL_SECONDS;
  const sessionId = crypto.randomUUID();

  await runQuery(
    db.insert(userSessions).values({
      id: sessionId,
      userId: user.id,
      tokenHash,
      expiresAt,
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      createdAt: created,
    } as never)
  );

  // Update lastLoginAt
  await runQuery(
    db
      .update(users)
      .set({ lastLoginAt: created, updatedAt: created } as never)
      .where(eq(users.id, user.id))
  );

  // Audit log — login
  const auditId = crypto.randomUUID();
  await runQuery(
    db.insert(auditLogs).values({
      id: auditId,
      actorId: user.id,
      action: "auth.login",
      targetType: "user",
      targetId: user.id,
      metadata: JSON.stringify({ email }),
      ipAddress: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      createdAt: created,
    } as never)
  );

  return {
    token,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role as Role,
      permissions,
    },
  };
}

/**
 * Destroy session by raw token.
 */
export async function logout(db: Db, rawToken: string): Promise<void> {
  if (!rawToken) throw new ApiError(401, "UNAUTHORIZED", "No session token");
  let tokenHash: string;
  try {
    tokenHash = hashTokenSync(rawToken);
  } catch {
    tokenHash = rawToken;
  }
  await runQuery(db.delete(userSessions).where(eq(userSessions.tokenHash, tokenHash)));
}

/**
 * Get current user from token (validates expiry).
 */
export async function getMe(
  db: Db,
  rawToken: string,
  now?: number
): Promise<{
  id: string;
  email: string;
  displayName: string;
  role: Role;
  permissions: Permission[];
} | null> {
  if (!rawToken) return null;
  let tokenHash: string;
  try {
    tokenHash = hashTokenSync(rawToken);
  } catch {
    return null;
  }
  const currentSec = nowSec(now);
  const sessionRows = await selectAll(
    db.select().from(userSessions).where(eq(userSessions.tokenHash, tokenHash))
  );
  const session = (sessionRows[0] as typeof userSessions.$inferSelect) ?? null;
  if (!session) return null;
  if ((session.expiresAt as number) <= currentSec) {
    // Expired — clean up and treat as unauth
    await runQuery(db.delete(userSessions).where(eq(userSessions.tokenHash, tokenHash)));
    return null;
  }
  const userRows = await selectAll(
    db
      .select()
      .from(users)
      .where(and(eq(users.id, session.userId), isNull(users.deletedAt)))
  );
  const user = (userRows[0] as typeof users.$inferSelect) ?? null;
  if (!user) return null;

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

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role as Role,
    permissions,
  };
}

/**
 * Create user — SUPER_ADMIN only (enforced at route, double-check here if actorRole provided).
 */
export async function createUser(
  db: Db,
  input: CreateUserInput,
  meta: { actorId?: string; ip?: string; userAgent?: string } = {}
): Promise<{ id: string; email: string; displayName: string; role: Role }> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password || !input.displayName) {
    throw new ApiError(400, "BAD_REQUEST", "email, password, displayName required");
  }
  if (input.password.length < 8)
    throw new ApiError(400, "BAD_REQUEST", "Password must be at least 8 characters");

  const role: Role = (input.role as Role) ?? "ADMIN";
  if (!["SUPER_ADMIN", "ADMIN"].includes(role))
    throw new ApiError(400, "BAD_REQUEST", "Invalid role");

  // Check duplicate email
  const existing = await selectOne<{ id: string }>(
    db.select({ id: users.id }).from(users).where(eq(users.email, email))
  );
  if (existing) throw new ApiError(409, "CONFLICT", "Email already exists");

  const passwordHash = await hashPassword(input.password);
  const id = crypto.randomUUID();
  const created = nowSec();

  await runQuery(
    db.insert(users).values({
      id,
      email,
      passwordHash,
      displayName: input.displayName.trim(),
      role,
      createdAt: created,
      updatedAt: created,
    } as never)
  );

  // Permissions — enforce WRITE→READ invariant, validate modules
  if (input.permissions && input.permissions.length > 0) {
    for (const p of input.permissions) {
      const normalized = normalizePermissionRow({
        module: p.module,
        canRead: p.canRead,
        canWrite: p.canWrite,
      });
      const permId = crypto.randomUUID();
      await runQuery(
        db.insert(adminPermissions).values({
          id: permId,
          userId: id,
          module: normalized.module,
          canRead: normalized.canRead,
          canWrite: normalized.canWrite,
          createdAt: created,
          updatedAt: created,
        } as never)
      );
    }
  }

  // Audit log — user creation
  if (meta.actorId) {
    const auditId = crypto.randomUUID();
    await runQuery(
      db.insert(auditLogs).values({
        id: auditId,
        actorId: meta.actorId,
        action: "users.create",
        targetType: "user",
        targetId: id,
        metadata: JSON.stringify({ email, role }),
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        createdAt: created,
      } as never)
    );
  }

  return { id, email, displayName: input.displayName.trim(), role };
}

export async function listUsers(db: Db): Promise<Array<typeof users.$inferSelect>> {
  const rows = await selectAll(db.select().from(users).where(isNull(users.deletedAt)));
  return rows as Array<typeof users.$inferSelect>;
}

/**
 * Update user fields (email/displayName/role/status) — SUPER_ADMIN only (§13.4).
 * Audits role/status changes.
 */
export async function updateUser(
  db: Db,
  userId: string,
  input: {
    email?: string;
    displayName?: string;
    role?: "SUPER_ADMIN" | "ADMIN";
    status?: "active" | "disabled";
  },
  meta: { actorId?: string; ip?: string; userAgent?: string } = {}
): Promise<typeof users.$inferSelect> {
  const rows = await selectAll(
    db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
  );
  const user = (rows[0] as typeof users.$inferSelect) ?? null;
  if (!user) throw new ApiError(404, "NOT_FOUND", "User not found");

  const now = nowSec();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (input.email !== undefined) updates.email = input.email.trim().toLowerCase();
  if (input.displayName !== undefined) updates.displayName = input.displayName.trim();
  if (input.role !== undefined) updates.role = input.role;
  if (input.status !== undefined) updates.status = input.status;

  if (Object.keys(updates).length > 1) {
    try {
      await runQuery(
        db
          .update(users)
          .set(updates as never)
          .where(eq(users.id, userId))
      );
    } catch (err) {
      if (/UNIQUE|constraint/i.test(err instanceof Error ? err.message : String(err))) {
        throw new ApiError(409, "CONFLICT", "Email already in use");
      }
      throw err;
    }
  }

  // §13.6 — audit role/status changes
  if (input.role !== undefined || input.status !== undefined) {
    await createAuditLogEntry(db, {
      actorId: meta.actorId ?? null,
      action: input.role !== undefined ? "user.role_changed" : "user.status_changed",
      targetType: "user",
      targetId: userId,
      metadata: { role: input.role, status: input.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  const refreshed = (
    await selectAll(db.select().from(users).where(eq(users.id, userId)))
  )[0] as typeof users.$inferSelect;
  return refreshed;
}

export async function getPermissionsForUser(
  db: Db,
  userId: string
): Promise<Array<{ module: string; canRead: number; canWrite: number }>> {
  const rows = await selectAll(
    db.select().from(adminPermissions).where(eq(adminPermissions.userId, userId))
  );
  return rows as Array<{ module: string; canRead: number; canWrite: number }>;
}

/**
 * Upsert permissions for a user — enforces WRITE→READ invariant.
 * Replaces existing rows for given modules.
 */
export async function upsertPermissions(
  db: Db,
  userId: string,
  permissions: Array<{ module: string; canRead?: boolean | number; canWrite?: boolean | number }>,
  meta: { actorId?: string; ip?: string; userAgent?: string } = {}
): Promise<void> {
  // Validate user exists
  const userRows = await selectAll(db.select().from(users).where(eq(users.id, userId)));
  if ((userRows as unknown[]).length === 0) throw new ApiError(404, "NOT_FOUND", "User not found");

  const created = nowSec();

  for (const p of permissions) {
    // Validate module is in 9 MODULES allowlist (but also allow extra for forward compat)
    if (!MODULES.includes(p.module as Module)) {
      throw new ApiError(400, "BAD_REQUEST", `Invalid module: ${p.module}`);
    }
    const normalized = normalizePermissionRow(p);

    // Upsert — try insert, on conflict update
    const existing = await selectOne<{ id: string }>(
      db
        .select({ id: adminPermissions.id })
        .from(adminPermissions)
        .where(
          and(eq(adminPermissions.userId, userId), eq(adminPermissions.module, normalized.module))
        )
    );
    if (existing) {
      await runQuery(
        db
          .update(adminPermissions)
          .set({
            canRead: normalized.canRead,
            canWrite: normalized.canWrite,
            updatedAt: created,
          } as never)
          .where(eq(adminPermissions.id, existing.id))
      );
    } else {
      const permId = crypto.randomUUID();
      await runQuery(
        db.insert(adminPermissions).values({
          id: permId,
          userId,
          module: normalized.module,
          canRead: normalized.canRead,
          canWrite: normalized.canWrite,
          createdAt: created,
          updatedAt: created,
        } as never)
      );
    }
  }

  if (meta.actorId) {
    const auditId = crypto.randomUUID();
    await runQuery(
      db.insert(auditLogs).values({
        id: auditId,
        actorId: meta.actorId,
        action: "permissions.update",
        targetType: "user",
        targetId: userId,
        metadata: JSON.stringify({ permissions }),
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        createdAt: created,
      } as never)
    );
  }
}

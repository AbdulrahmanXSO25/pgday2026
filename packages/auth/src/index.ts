// Auth & RBAC — two roles, 9 modules, WRITE→READ invariant.
export const ROLES = ["SUPER_ADMIN", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const MODULES = [
  "events",
  "users",
  "speakers",
  "sessions",
  "sponsors",
  "registrations",
  "media",
  "cfp",
  "publishing",
] as const;
export type Module = (typeof MODULES)[number];

export type Permission = `${Module}:READ` | `${Module}:WRITE`;

// Helpers for RBAC matrix
export function hasPermission(
  role: Role,
  permissions: Permission[],
  required: Permission
): boolean {
  if (role === "SUPER_ADMIN") return true;
  if (permissions.includes(required)) return true;
  // WRITE implies READ
  if (required.endsWith(":READ")) {
    const write = required.replace(":READ", ":WRITE") as Permission;
    if (permissions.includes(write)) return true;
  }
  return false;
}

/**
 * Normalize permission rows — enforces WRITE→READ invariant at write time.
 * Input: { module, canRead, canWrite } (boolean|0|1)
 * Output: { module, canRead: 0|1, canWrite: 0|1 } with canWrite→canRead
 */
export function normalizePermissionRow(input: {
  module: string;
  canRead?: boolean | number;
  canWrite?: boolean | number;
}): { module: Module; canRead: 0 | 1; canWrite: 0 | 1 } {
  const mod = input.module as Module;
  if (!MODULES.includes(mod)) {
    throw new Error(`Invalid module: ${input.module}`);
  }
  const canWrite = input.canWrite ? 1 : 0;
  const canRead = input.canWrite ? 1 : input.canRead ? 1 : 0;
  return { module: mod, canRead: canRead as 0 | 1, canWrite: canWrite as 0 | 1 };
}

/**
 * All permissions for SUPER_ADMIN (computed, not stored).
 */
export function allPermissionsForSuperAdmin(): Permission[] {
  const out: Permission[] = [];
  for (const m of MODULES) {
    out.push(`${m}:READ` as Permission, `${m}:WRITE` as Permission);
  }
  return out;
}

/**
 * Convert admin_permissions rows to Permission[] strings.
 */
export function permissionsFromRows(
  rows: Array<{ module: string; canRead: number; canWrite: number }>
): Permission[] {
  const out: Permission[] = [];
  for (const r of rows) {
    if (r.canRead) out.push(`${r.module}:READ` as Permission);
    if (r.canWrite) out.push(`${r.module}:WRITE` as Permission);
  }
  return out;
}

// Re-exports for convenience — keep barrel minimal, deep imports still work
export { hashPassword, verifyPassword, ARGON2_OPTS } from "./hash";
export {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  generateSessionToken,
  hashToken,
  hashTokenSync,
  buildSessionCookie,
  parseSessionToken,
  sessionCookieOptions,
} from "./session";

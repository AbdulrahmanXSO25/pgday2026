import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { ApiError } from "./errorHandler.js";
import { hasPermission, type Permission } from "@pgegypt/auth";
import type { AuthUser } from "./auth.js";

/**
 * Permission stub — implements RBAC matrix check using @pgegypt/auth helper.
 * WRITE implies READ invariant is handled inside `hasPermission`.
 *
 * Final behaviour (subtask 06 will wire real permissions from DB):
 *  - SUPER_ADMIN passes any check.
 *  - ADMIN needs explicit permission; 403 otherwise.
 *
 * For subtask 03, this is correctly wired but relies on injected test user
 * (via X-Test-User). When no user is present, `requireAuth` already returns 401
 * before this runs, so ordering matters: `requireAuth()` -> `requirePermission(...)`
 */

export function requirePermission(
  permissionOrModule: Permission | string,
  level?: "READ" | "WRITE"
): MiddlewareHandler<AppEnv> {
  const required: Permission = level
    ? (`${permissionOrModule}:${level}` as Permission)
    : (permissionOrModule as Permission);
  return async (c, next) => {
    const user = c.get("user" as never) as AuthUser | undefined;
    if (!user) {
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    }
    const ok = hasPermission(user.role, user.permissions, required);
    if (!ok) {
      throw new ApiError(403, "FORBIDDEN", `Missing permission ${required}`);
    }
    await next();
  };
}

export function requireSuperAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user" as never) as AuthUser | undefined;
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    if (user.role !== "SUPER_ADMIN") throw new ApiError(403, "FORBIDDEN", "SUPER_ADMIN required");
    await next();
  };
}

/**
 * Shorthand for WRITE-or-READ checks (WRITE implies READ).
 * Not needed separately since hasPermission already handles it, but kept for readability.
 */
export function requireRead(module: string): MiddlewareHandler<AppEnv> {
  const perm = `${module}:READ` as Permission;
  return requirePermission(perm);
}

export function requireWrite(module: string): MiddlewareHandler<AppEnv> {
  const perm = `${module}:WRITE` as Permission;
  return requirePermission(perm);
}

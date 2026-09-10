import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { ApiError } from "./errorHandler.js";
import { hasPermission, type Permission, type Module } from "@pgegypt/auth";
import type { AuthUser } from "./auth.js";

/**
 * requirePermission — RBAC matrix guard.
 * Supports signatures:
 *   requirePermission("users:READ")
 *   requirePermission("users", "READ")
 *   requirePermission("users", "WRITE")
 *
 * Returns 401 if unauthenticated, 403 if forbidden.
 * SUPER_ADMIN bypasses all checks via hasPermission.
 */
export function requirePermission(
  permissionOrModule: Permission | Module | string,
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

/**
 * Guard that only SUPER_ADMIN can pass — used for users/permissions & audit (§35).
 */
export function requireSuperAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user" as never) as AuthUser | undefined;
    if (!user) {
      throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    }
    if (user.role !== "SUPER_ADMIN") {
      throw new ApiError(403, "FORBIDDEN", "SUPER_ADMIN required");
    }
    await next();
  };
}

// Convenience wrappers — keep compatibility with permission.ts
export function requireRead(module: string): MiddlewareHandler<AppEnv> {
  return requirePermission(`${module}:READ` as Permission);
}

export function requireWrite(module: string): MiddlewareHandler<AppEnv> {
  return requirePermission(`${module}:WRITE` as Permission);
}

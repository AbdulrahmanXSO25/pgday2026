import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { ApiError } from "./errorHandler.js";

/**
 * CSRF defense-in-depth (§30.2).
 *
 * SameSite=Lax already blocks cross-site POSTs, but for admin mutations we
 * additionally require a custom header that a cross-site <form> cannot set:
 *   X-Requested-With: pgegypt-admin
 *
 * Enforced in production only — local dev/tests (RUNTIME != production) stay
 * frictionless, and the header is always sent by admin-web's fetch wrapper.
 */
export function csrfAdminMiddleware(): MiddlewareHandler<AppEnv> {
  const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  return async (c, next) => {
    const runtime =
      (c.get("runtime" as never) as string | undefined) ??
      (c.env as { RUNTIME?: string } | undefined)?.RUNTIME ??
      (typeof process !== "undefined" ? (process.env.RUNTIME ?? process.env.NODE_ENV) : undefined);
    const isProd = runtime === "production";
    if (!isProd) {
      await next();
      return;
    }
    const path = new URL(c.req.url).pathname;
    const method = (c.req as { method?: string }).method ?? "GET";
    const isAdminMutation = path.startsWith("/v1/admin/") && MUTATING.has(method);
    if (!isAdminMutation) {
      await next();
      return;
    }
    if (c.req.header("x-requested-with") !== "pgegypt-admin") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Missing X-Requested-With: pgegypt-admin (CSRF protection)"
      );
    }
    await next();
  };
}

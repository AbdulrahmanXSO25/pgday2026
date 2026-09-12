import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "../app.js";

/**
 * CORS middleware — explicit origin allowlist, credentials never true.
 *
 * Applies to ALL paths (public + admin): after the admin static migration the
 * admin panel calls the API cross-origin with a bearer token (Authorization
 * header), so it needs CORS headers too. No cookies cross-origin → no
 * Access-Control-Allow-Credentials.
 *
 * Registered FIRST in the middleware chain, and errorHandler attaches the same
 * headers on 5xx — a thrown error must never produce a CORS-less response
 * (browsers report that as a CORS failure and it costs hours to debug).
 */

const PUBLIC_PATH_PREFIXES = ["/v1/registrations", "/v1/cfp", "/v1/health", "/health"] as const;

// §30.3 — explicit origin allowlist (public-web + admin-web + local dev), credentials never true
const ALLOWED_ORIGINS = new Set([
  "https://pgegypt-public-web.abdulrahmannader-123.workers.dev",
  "https://pgegypt-admin-web.abdulrahmannader-123.workers.dev",
  "https://pgegypt-public-web.pages.dev",
  "https://pgegypt-admin-web.pages.dev",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
]);

function isPublicPath(path: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?") || path === p
  );
}

function isPublicRequest(pathname: string): boolean {
  const base = pathname.split("?")[0] ?? "";
  if (base === "/health" || base === "/v1/health") return true;
  if (base === "/v1/registrations" || base.startsWith("/v1/registrations/")) return true;
  if (base === "/v1/cfp" || base.startsWith("/v1/cfp/")) return true;
  return false;
}

/** Resolve the allowed origin for a request, or null (no CORS headers). */
export function resolveAllowedOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

/** Attach CORS headers to an existing response (used by errorHandler on 5xx). */
export function applyCorsHeaders(
  c: { req: { header(n: string): string | undefined } },
  response: Response
): Response {
  const origin = resolveAllowedOrigin(c.req.header("origin"));
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Request-Id, X-Requested-With"
  );
  headers.set("Access-Control-Expose-Headers", "X-Request-Id");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Main middleware — CORS for every request whose Origin is allowlisted.
 * OPTIONS preflight short-circuits with 204.
 */
export function corsMiddleware(): MiddlewareHandler<AppEnv> {
  const publicCors = cors({
    origin: (origin: string | undefined) => resolveAllowedOrigin(origin),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Requested-With"],
    exposeHeaders: ["X-Request-Id"],
    credentials: false,
    maxAge: 86400,
  });

  return async (c, next) => {
    const origin = resolveAllowedOrigin(c.req.header("origin"));
    if (!origin) {
      // Not an allowlisted origin — no CORS headers; still serve same-origin requests
      await next();
      return;
    }
    // Preflight and normal requests both get CORS headers from hono/cors
    return publicCors(c, next);
  };
}

// Export helpers for testing / route-level overrides
export { isPublicPath, isPublicRequest };

/**
 * Route-level explicit public cors — usable as `app.use('/v1/registrations/*', publicCors())`
 * if per-route mounting is preferred.
 */
export function publicCorsMiddleware(): MiddlewareHandler<AppEnv> {
  return cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    exposeHeaders: ["X-Request-Id"],
    credentials: false,
    maxAge: 86400,
  });
}

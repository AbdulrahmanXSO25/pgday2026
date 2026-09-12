import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "../app.js";

/**
 * CORS middleware — split for public vs admin.
 *
 * Public routes (no credentials, open origins):
 *   - POST /v1/registrations  (public registration form)
 *   - POST /v1/cfp/submissions and GET /v1/cfp/submissions (public CFP)
 *
 * These are called directly from public-web fetch; no cookie credentials.
 *
 * Admin routes are same-origin via admin-web Next.js proxy
 * (`admin-web` -> `/api/:path*` -> API_BASE_URL/v1/:path*),
 * so they do not need CORS. We skip cors for those to avoid
 * exposing credentials to third-party origins.
 *
 * For local dev we also allow localhost origins when present,
 * but public routes remain credential-free.
 */

const PUBLIC_PATH_PREFIXES = ["/v1/registrations", "/v1/cfp", "/v1/health", "/health"] as const;

// §30.3 — explicit origin allowlist (public-web + admin-web + local dev), credentials never true
const ALLOWED_ORIGINS = new Set([
  "https://pgegypt-public-web.abdulrahmannader-123.workers.dev",
  "https://pgegypt-admin-web.abdulrahmannader-123.workers.dev",
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

// Shared handler for more precise check: we inspect url pathname
function isPublicRequest(pathname: string): boolean {
  // Normalize: /v1/registrations?foo=bar -> /v1/registrations
  const base = pathname.split("?")[0] ?? "";
  if (base === "/health" || base === "/v1/health") return true;
  if (base === "/v1/registrations" || base.startsWith("/v1/registrations/")) return true;
  if (base === "/v1/cfp" || base.startsWith("/v1/cfp/")) return true;
  // Also allow OPTIONS preflight for those paths
  return false;
}

/**
 * Main middleware entry — delegates to Hono's cors for public paths only.
 * Admin/same-origin paths bypass cors entirely.
 */
export function corsMiddleware(): MiddlewareHandler<AppEnv> {
  const publicCors = cors({
    origin: (origin: string | undefined) => (origin && ALLOWED_ORIGINS.has(origin) ? origin : null),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Requested-With"],
    exposeHeaders: ["X-Request-Id"],
    credentials: false,
    maxAge: 86400,
  });

  // No-op cors for admin — we just continue without CORS headers.
  // Keeping same middleware shape for composition.

  return async (c, next) => {
    const url = new URL(c.req.url);
    if (isPublicRequest(url.pathname)) {
      return publicCors(c, next);
    }
    // Admin / same-origin: no cors headers, just proceed
    await next();
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

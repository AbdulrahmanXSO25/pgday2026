import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";

/**
 * Secure headers middleware — CSP, HSTS, X-Frame-Options, X-Content-Type-Options etc.
 * Applied globally; never logs secrets.
 */

export function secureHeadersMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();

    // These headers are set on response after downstream completes
    // Do not overwrite if already set by route
    const setIfMissing = (name: string, value: string) => {
      if (!c.res.headers.get(name)) c.header(name, value);
    };

    // CSP — for API (JSON only) keep strict, but allow 'unsafe-inline' for Next HMR when proxied via admin-web
    setIfMissing(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join("; ")
    );

    // HSTS — 1 year, includeSubDomains, preload
    setIfMissing("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");

    // Clickjacking protection
    setIfMissing("X-Frame-Options", "DENY");

    // MIME sniffing
    setIfMissing("X-Content-Type-Options", "nosniff");

    // Referrer
    setIfMissing("Referrer-Policy", "strict-origin-when-cross-origin");

    // Permissions policy minimal
    setIfMissing("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    // XSS filter (legacy but still useful)
    setIfMissing("X-XSS-Protection", "0");

    // Cross-domain policies
    setIfMissing("Cross-Origin-Opener-Policy", "same-origin");
    setIfMissing("Cross-Origin-Resource-Policy", "same-origin");
  };
}

// Export header map for testing and for Next.js next.config headers()
export function getSecureHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-XSS-Protection": "0",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

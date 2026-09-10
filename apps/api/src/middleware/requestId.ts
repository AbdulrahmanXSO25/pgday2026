import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";

/**
 * Request ID middleware — pure, no global state.
 * - Uses incoming X-Request-Id if present and valid (replay-safe), else generates new.
 * - Sets typed context `requestId` and response header `X-Request-Id`.
 */
export function requestIdMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header("X-Request-Id");
    const id = isValidRequestId(incoming) ? incoming! : crypto.randomUUID();
    c.set("requestId", id);
    // Set header early; Hono will include on response even if downstream throws
    c.header("X-Request-Id", id);
    await next();
  };
}

function isValidRequestId(value: string | undefined): boolean {
  if (!value) return false;
  // Accept any non-empty string up to 128 chars without control chars
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return false;
  // Reject if contains control chars

  if (/[\x00-\x1F\x7F]/.test(trimmed)) return false;
  return true;
}

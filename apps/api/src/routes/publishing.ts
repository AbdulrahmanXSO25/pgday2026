import { Hono } from "hono";
import type { AppEnv } from "../app.js";

/**
 * Legacy publishing placeholder — real implementation moved to ./publish.ts (§16).
 * Kept for audit route stubs; publishing publish routes now live in publish.ts.
 * This router intentionally empty to avoid 501 conflicts — publishRoutes handles /v1/admin/publishing/*.
 */
export function publishingRoutes() {
  const r = new Hono<AppEnv>();
  // Audit routes remain here until audit subtask fleshes them out; publishing publish routes handled in publish.ts
  // Keeping empty here ensures publishRoutes registered in index is authoritative.
  return r;
}

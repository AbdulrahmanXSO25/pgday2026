import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { requireAuth } from "../middleware/auth.js";
import { requireSuperAdmin } from "../middleware/requirePermission.js";
import { requireDb } from "../lib/db.js";
import * as auditService from "../services/audit.service.js";

/**
 * Audit routes — §32
 * - GET /v1/audit-logs            SUPER_ADMIN only
 * - GET /v1/admin/audit-logs      SUPER_ADMIN only (alias)
 *
 * Records every mutation (actor, action, target, timestamp) with PII redaction;
 * creation is via audit.service.createAuditLog called from services.
 */

export function auditRoutes() {
  const r = new Hono<AppEnv>();

  const listHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const query = c.req.query() as Record<string, string>;
    const limit = query.limit ? Number(query.limit) : undefined;
    const offset = query.offset ? Number(query.offset) : undefined;

    const data = await auditService.listAuditLogs(db, {
      limit: Number.isFinite(limit as number) ? (limit as number) : undefined,
      offset: Number.isFinite(offset as number) ? (offset as number) : undefined,
    });

    return c.json(
      {
        success: true as const,
        data,
        meta: { count: data.length },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };

  // Canonical
  r.get("/v1/audit-logs", requireAuth(), requireSuperAdmin(), listHandler);
  // Admin alias (also required by existing usersRoutes)
  r.get("/v1/admin/audit-logs", requireAuth(), requireSuperAdmin(), listHandler);
  // §26.3 spec alias — GET /v1/admin/audit
  r.get("/v1/admin/audit", requireAuth(), requireSuperAdmin(), listHandler);

  return r;
}

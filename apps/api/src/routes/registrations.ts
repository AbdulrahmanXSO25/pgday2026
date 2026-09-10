import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { RegistrationSchema } from "@pgegypt/validation";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permission.js";
import { getDb, requireDb } from "../lib/db.js";
import { ApiError } from "../middleware/errorHandler.js";
import * as registrationService from "../services/registration.service.js";
import { getClientIpFromHeaders } from "../repositories/registration.repo.js";
import { createInMemoryQueue } from "@pgegypt/queue";
import { createMaildevMailer } from "@pgegypt/mail";

/**
 * Registrations routes — §18, §26, §34
 * - POST /v1/registrations  public, Zod validated, rate-limited via rate_limits table (5/hour), duplicate race →409
 * - GET /v1/admin/registrations  auth + RBAC registrations:READ
 *
 * Pure composition, DI via c.get('db'), explicit errors.
 */

// Shared in-process queue/mailer for local — best-effort, never fail registration
const localQueue = createInMemoryQueue<unknown>();
const localMailer = createMaildevMailer();

// Setup local queue handler — delivers via Maildev SMTP (:1025, UI :1080) in dev.
// In prod the Worker's queue() consumer sends via Resend (§25).
try {
  localQueue.process(async (msg) => {
    const payload = (msg as { payload?: Record<string, unknown> }).payload;
    if (payload) {
      const res = await localMailer.send(payload as never);
      if (!res.ok) console.error("[registrations] local email failed (non-fatal):", res.error);
    }
  });
} catch {
  // ignore double-register
}

function getClientIp(c: { req: { header(n: string): string | undefined } }): string {
  return getClientIpFromHeaders({
    get: (n: string) => c.req.header(n) ?? null,
  });
}

export function registrationRoutes() {
  const r = new Hono<AppEnv>();

  // Public — no auth, Zod boundary validation via @hono/zod-validator (422 on failure)
  r.post("/v1/registrations", validateJson(RegistrationSchema), async (c: Context<AppEnv>) => {
    const payload = c.req.valid(
      "json" as never
    ) as import("@pgegypt/validation").RegistrationPayload;
    const db = getDb(c as Context<AppEnv>);
    if (!db) throw new ApiError(500, "INTERNAL_ERROR", "DB not available");

    const ip = getClientIp(c as { req: { header(n: string): string | undefined } });

    const result = await registrationService.createRegistration(
      { db, queue: localQueue as never, mailer: localMailer as never },
      payload,
      ip
    );

    // 201 Created per api-design.md
    return c.json(
      {
        success: true as const,
        data: { id: result.id, email: result.email, eventId: result.eventId },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      201
    );
  });

  // Admin list — guarded by RBAC (registrations:READ)
  // SUPER_ADMIN passes automatically via hasPermission; ADMIN needs explicit permission
  r.get(
    "/v1/admin/registrations",
    requireAuth(),
    requirePermission("registrations:READ" as never),
    async (c: Context<AppEnv>) => {
      const db = requireDb(c as Context<AppEnv>);
      const query = c.req.query() as unknown as Record<string, string>;
      const data = await registrationService.listRegistrations(db, query);
      return c.json({
        success: true as const,
        data,
        meta: { count: data.length },
        requestId: c.get("requestId" as never) as string | undefined,
      });
    }
  );

  // Legacy alias — same guard (kept for backwards compatibility with earlier scaffold)
  r.get(
    "/v1/registrations",
    requireAuth(),
    requirePermission("registrations:READ" as never),
    async (c: Context<AppEnv>) => {
      const db = requireDb(c as Context<AppEnv>);
      const query = c.req.query() as unknown as Record<string, string>;
      const data = await registrationService.listRegistrations(db, query);
      return c.json({
        success: true as const,
        data,
        meta: { count: data.length },
        requestId: c.get("requestId" as never) as string | undefined,
      });
    }
  );

  // §26.3 — CSV export (registrations:READ). Flat file, no PII beyond what the list already exposes.
  r.get(
    "/v1/admin/registrations/export.csv",
    requireAuth(),
    requirePermission("registrations:READ" as never),
    async (c: Context<AppEnv>) => {
      const db = requireDb(c as Context<AppEnv>);
      const query = c.req.query() as unknown as Record<string, string>;
      const rows = (await registrationService.listRegistrations(db, query)) as Array<
        Record<string, unknown>
      >;
      const columns = [
        "id",
        "name",
        "email",
        "organization",
        "role",
        "status",
        "checkedInAt",
        "createdAt",
      ];
      const escape = (v: unknown): string => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
      };
      const csv = [
        columns.join(","),
        ...rows.map((r) => columns.map((col) => escape(r[col])).join(",")),
      ].join("\n");
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="registrations-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
  );

  return r;
}

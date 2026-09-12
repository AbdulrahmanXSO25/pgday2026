import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { requireDb } from "../lib/db.js";
import * as checkinService from "../services/checkin.service.js";
import { createAuditLog } from "../services/audit.service.js";
import { createLocalEmailPipeline } from "../jobs/emailConsumer.js";
import { resolveEmailQueue, type EmailQueue } from "../lib/queue.js";
import { hasPermission } from "@pgegypt/auth";
import type { AuthUser } from "../middleware/auth.js";
import { ApiError } from "../middleware/errorHandler.js";

// Best-effort local email pipeline — status-change emails must never fail the request (§18.5)
const { queue: statusQueue, mailer: statusMailer } = createLocalEmailPipeline();

// ---------------------------------------------------------------------------
// Schemas — Zod at boundaries
// ---------------------------------------------------------------------------

const CheckinSchema = z.object({
  token: z.string().min(1, { error: "token is required" }).max(256),
});

const ConfirmParamsSchema = z.object({
  id: z.string().min(1),
});

function getMeta(c: Context<AppEnv>): { ip: string; userAgent: string; actorId?: string } {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const ua = c.req.header("user-agent") ?? "unknown";
  const user = c.get("user" as never) as { id: string } | undefined;
  return { ip, userAgent: ua, actorId: user?.id };
}

/** Drizzle-agnostic select helper (better-sqlite3 sync vs D1 async). */
async function selectAllRows(query: unknown): Promise<unknown[]> {
  const q = query as Record<string, unknown>;
  if (typeof q.all === "function") {
    const res = (q.all as () => unknown)();
    const awaited = res instanceof Promise ? await res : res;
    if (Array.isArray(awaited)) return awaited;
    if (
      awaited &&
      typeof awaited === "object" &&
      "results" in (awaited as Record<string, unknown>)
    ) {
      return ((awaited as Record<string, unknown>).results as unknown[]) ?? [];
    }
    return Array.isArray(awaited) ? awaited : [];
  }
  const res = await (query as Promise<unknown>);
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && "results" in (res as Record<string, unknown>)) {
    return ((res as Record<string, unknown>).results as unknown[]) ?? [];
  }
  return [];
}

/**
 * Best-effort acceptance email when a registration transitions to confirmed.
 * Idempotent via key — re-confirming an already-confirmed registration does not re-send.
 */
async function sendAcceptanceEmail(
  db: import("@pgegypt/db").Db,
  id: string,
  queue: EmailQueue | null
): Promise<void> {
  void (async () => {
    try {
      const { registrations } = await import("@pgegypt/db");
      const { eq } = await import("drizzle-orm");
      const rows = (await selectAllRows(
        db.select().from(registrations).where(eq(registrations.id, id))
      )) as Array<{ email?: string; name?: string; eventId?: string }>;
      const reg = rows[0];
      if (!reg?.email) return;
      const job = {
        type: "registration_acceptance" as const,
        to: reg.email,
        name: reg.name ?? "there",
        eventId: reg.eventId,
        idempotencyKey: `reg-status:${reg.email.toLowerCase()}:${reg.eventId ?? "default"}:acceptance`,
      };
      const activeQueue = queue ?? statusQueue;
      if (activeQueue && typeof activeQueue.enqueue === "function") {
        await statusQueue.enqueue(job);
      } else if (statusMailer && typeof statusMailer.send === "function") {
        const { buildRegistrationAcceptedEmail } = await import("@pgegypt/mail");
        const siteUrl = process.env.SITE_URL ?? "https://2026day.pgegypt.org";
        const tpl = buildRegistrationAcceptedEmail({ name: reg.name ?? "there", siteUrl });
        const res = await statusMailer.send({
          to: reg.email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        });
        if (!res.ok)
          console.error("[registrations] acceptance email failed (non-fatal):", res.error);
      }
    } catch (err) {
      console.error(
        "[registrations] acceptance email failed (non-fatal):",
        err instanceof Error ? err.message : String(err)
      );
    }
  })();
}

/**
 * §18.4 — manual registration status change (pending/waitlisted/declined):
 * updates status, writes an audit_logs row, and sends a best-effort email.
 */
async function applyRegistrationStatusChange(
  db: import("@pgegypt/db").Db,
  id: string,
  status: string,
  meta: { ip: string; userAgent: string; actorId?: string },
  queue: EmailQueue | null
): Promise<void> {
  const { registrations } = await import("@pgegypt/db");
  const { eq } = await import("drizzle-orm");
  const now = Math.floor(Date.now() / 1000);
  await runUpdate(db, registrations, { status, updatedAt: now }, id);

  await createAuditLog(db, {
    actorId: meta.actorId ?? null,
    action: "registration.status_changed",
    targetType: "registration",
    targetId: id,
    metadata: { status },
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });

  void (async () => {
    try {
      const rows = (await selectAllRows(
        db.select().from(registrations).where(eq(registrations.id, id))
      )) as Array<{
        email?: string;
        name?: string;
        eventId?: string;
      }>;
      const reg = rows[0];
      if (reg?.email) {
        const job =
          status === "confirmed"
            ? {
                type: "registration_acceptance" as const,
                to: reg.email,
                name: reg.name ?? "there",
                eventId: reg.eventId,
                idempotencyKey: `reg-status:${reg.email.toLowerCase()}:${reg.eventId ?? "default"}:acceptance`,
              }
            : status === "declined"
              ? {
                  type: "registration_rejection" as const,
                  to: reg.email,
                  name: reg.name ?? "there",
                  eventId: reg.eventId,
                  idempotencyKey: `reg-status:${reg.email.toLowerCase()}:${reg.eventId ?? "default"}:rejection`,
                }
              : {
                  type: "registration_waitlist" as const,
                  to: reg.email,
                  name: reg.name ?? "there",
                  eventId: reg.eventId,
                  idempotencyKey: `reg-status:${reg.email.toLowerCase()}:${reg.eventId ?? "default"}:waitlist`,
                };
        const activeQueue = queue ?? statusQueue;
        if (activeQueue && typeof activeQueue.enqueue === "function") {
          await statusQueue.enqueue(job);
        } else if (statusMailer && typeof statusMailer.send === "function") {
          // Direct-mailer fallback — build the template inline
          const {
            buildRegistrationAcceptedEmail,
            buildRegistrationRejectedEmail,
            buildRegistrationWaitlistEmail,
          } = await import("@pgegypt/mail");
          const siteUrl = process.env.SITE_URL ?? "https://2026day.pgegypt.org";
          const tpl =
            status === "confirmed"
              ? buildRegistrationAcceptedEmail({ name: reg.name ?? "there", siteUrl })
              : status === "declined"
                ? buildRegistrationRejectedEmail({ name: reg.name ?? "there", siteUrl })
                : buildRegistrationWaitlistEmail({ name: reg.name ?? "there", siteUrl });
          const res = await statusMailer.send({
            to: reg.email,
            subject: tpl.subject,
            html: tpl.html,
            text: tpl.text,
          });
          if (!res.ok) console.error("[registrations] status email failed (non-fatal):", res.error);
        }
      }
    } catch (err) {
      console.error(
        "[registrations] status email failed (non-fatal):",
        err instanceof Error ? err.message : String(err)
      );
    }
  })();
}

/** Drizzle-agnostic update helper (sync vs async). */
async function runUpdate(
  db: unknown,
  table: unknown,
  values: Record<string, unknown>,
  id: string
): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const q = (
    db as { update: (t: unknown) => { set: (v: unknown) => { where: (w: unknown) => unknown } } }
  )
    .update(table)
    .set(values as never)
    .where(eq((table as { id: unknown }).id as never, id));
  const qq = q as unknown as { run?: () => unknown };
  if (typeof qq.run === "function") {
    const res = qq.run();
    if (res instanceof Promise) await res;
  } else {
    await (q as unknown as Promise<unknown>);
  }
}

// checkin requires registrations:WRITE (or checkin:WRITE alias if added).
// We enforce registrations:WRITE per spec parenthetical — checkin module not in DB allowlist.
// To also accept checkin:WRITE for forward compat, we check either via custom middleware.

function requireCheckinWrite(): MiddlewareHandler<AppEnv> {
  return async (c: Context<AppEnv>, next) => {
    const user = c.get("user" as never) as AuthUser | undefined;
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    const okRegistrations = hasPermission(
      user.role,
      user.permissions,
      "registrations:WRITE" as never
    );
    const okCheckin = hasPermission(user.role, user.permissions, "checkin:WRITE" as never);
    // Also allow SUPER_ADMIN via hasPermission already.
    if (!okRegistrations && !okCheckin) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Missing permission registrations:WRITE or checkin:WRITE"
      );
    }
    await next();
  };
}

export function checkinRoutes() {
  const r = new Hono<AppEnv>();

  // POST /v1/check-in — validate opaque token, idempotent
  r.post(
    "/v1/check-in",
    requireAuth(),
    requireCheckinWrite(),
    validateJson(CheckinSchema),
    async (c: Context<AppEnv>) => {
      const body = c.req.valid("json" as never) as z.infer<typeof CheckinSchema>;
      const db = requireDb(c as Context<AppEnv>);
      const meta = getMeta(
        c as { req: { header(n: string): string | undefined }; get(key: string): unknown } as never
      );

      const result = await checkinService.performCheckin(db, body.token, {
        actorId: meta.actorId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      if (result.status === "already_checked_in") {
        return c.json(
          {
            success: true as const,
            data: {
              registrationId: result.registration.id,
              status: "already_checked_in" as const,
              checkedInAt: result.registration.checkedInAt,
              registration: result.registration,
            },
            requestId: c.get("requestId" as never) as string | undefined,
          },
          200
        );
      }

      return c.json(
        {
          success: true as const,
          data: {
            registrationId: result.registration.id,
            status: "checked_in" as const,
            checkedInAt: result.registration.checkedInAt,
            registration: result.registration,
          },
          requestId: c.get("requestId" as never) as string | undefined,
        },
        200
      );
    }
  );

  // Alias: POST /v1/admin/check-in
  r.post(
    "/v1/admin/check-in",
    requireAuth(),
    requireCheckinWrite(),
    validateJson(CheckinSchema),
    async (c: Context<AppEnv>) => {
      const body = c.req.valid("json" as never) as z.infer<typeof CheckinSchema>;
      const db = requireDb(c as Context<AppEnv>);
      const meta = getMeta(c as never);
      const result = await checkinService.performCheckin(db, body.token, {
        actorId: meta.actorId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const status = result.status;
      return c.json(
        {
          success: true as const,
          data: {
            registrationId: result.registration.id,
            status,
            checkedInAt: result.registration.checkedInAt,
            registration: result.registration,
          },
          requestId: c.get("requestId" as never) as string | undefined,
        },
        200
      );
    }
  );

  // POST /v1/registrations/:id/confirm — generate token at confirm
  // Also PATCH alias for backwards compat
  const confirmHandler = async (c: import("hono").Context<AppEnv>) => {
    const id = c.req.param("id") as string;
    const db = requireDb(c);
    const meta = getMeta(c as never);
    const result = await checkinService.confirmRegistration(db, id, {
      actorId: meta.actorId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    // Best-effort acceptance email — only when newly confirmed (idempotent re-confirm skips)
    if (!result.alreadyConfirmed) {
      await sendAcceptanceEmail(db, id, resolveEmailQueue(c.env as never));
    }
    return c.json(
      {
        success: true as const,
        data: {
          registration: result.registration,
          // Return plain token only when newly generated — one-time display
          checkinToken: result.plainToken,
          alreadyConfirmed: result.alreadyConfirmed,
        },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };

  r.post("/v1/registrations/:id/confirm", requireAuth(), requireCheckinWrite(), confirmHandler);
  r.post(
    "/v1/admin/registrations/:id/confirm",
    requireAuth(),
    requireCheckinWrite(),
    confirmHandler
  );

  // PATCH /v1/registrations/:id — status transition to confirmed triggers token generation
  // Keeps confirm logic centralized; if body.status === "confirmed" we generate token.
  r.patch(
    "/v1/registrations/:id",
    requireAuth(),
    requireCheckinWrite(),
    async (c: Context<AppEnv>) => {
      let body: Record<string, unknown> = {};
      try {
        body = (await c.req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
      const status = (body.status as string | undefined)?.trim().toLowerCase();
      const id = c.req.param("id") as string;
      const db = requireDb(c as Context<AppEnv>);
      const meta = getMeta(c as never);

      if (status === "confirmed") {
        const result = await checkinService.confirmRegistration(db, id, {
          actorId: meta.actorId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        // Best-effort acceptance email — only when newly confirmed
        if (!result.alreadyConfirmed) {
          await sendAcceptanceEmail(db, id, resolveEmailQueue(c.env as never));
        }
        return c.json(
          {
            success: true as const,
            data: {
              registration: result.registration,
              checkinToken: result.plainToken,
              alreadyConfirmed: result.alreadyConfirmed,
            },
            requestId: c.get("requestId" as never) as string | undefined,
          },
          200
        );
      }

      // Non-confirm patch — simple status update (pending/waitlisted/declined)
      if (status && ["pending", "waitlisted", "declined"].includes(status)) {
        await applyRegistrationStatusChange(
          db,
          id,
          status,
          meta,
          resolveEmailQueue(c.env as never)
        );
        return c.json(
          {
            success: true as const,
            data: { id, status },
            requestId: c.get("requestId" as never) as string | undefined,
          },
          200
        );
      }
      // If no status, return 400
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "status must be one of pending, confirmed, waitlisted, declined"
      );
    }
  );

  // Alias for admin patch
  r.patch(
    "/v1/admin/registrations/:id",
    requireAuth(),
    requireCheckinWrite(),
    async (c: Context<AppEnv>) => {
      let body: Record<string, unknown> = {};
      try {
        body = (await c.req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }
      const status = (body.status as string | undefined)?.trim().toLowerCase();
      const id = c.req.param("id") as string;
      const db = requireDb(c as Context<AppEnv>);
      const meta = getMeta(c as never);
      if (status === "confirmed") {
        const result = await checkinService.confirmRegistration(db, id, {
          actorId: meta.actorId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        // Best-effort acceptance email — only when newly confirmed
        if (!result.alreadyConfirmed) {
          await sendAcceptanceEmail(db, id, resolveEmailQueue(c.env as never));
        }
        return c.json(
          {
            success: true as const,
            data: {
              registration: result.registration,
              checkinToken: result.plainToken,
              alreadyConfirmed: result.alreadyConfirmed,
            },
            requestId: c.get("requestId" as never) as string | undefined,
          },
          200
        );
      }
      // §18.4 — manual status changes (pending/waitlisted/declined) are supported on the admin alias too
      if (status && ["pending", "waitlisted", "declined"].includes(status)) {
        await applyRegistrationStatusChange(
          db,
          id,
          status,
          meta,
          resolveEmailQueue(c.env as never)
        );
        return c.json(
          {
            success: true as const,
            data: { id, status },
            requestId: c.get("requestId" as never) as string | undefined,
          },
          200
        );
      }
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "status must be one of pending, confirmed, waitlisted, declined"
      );
    }
  );

  // §24.3 — GET /v1/admin/checkin/search?q= — manual fallback (name/email/token)
  const searchHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c as Context<AppEnv>);
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const { registrations } = await import("@pgegypt/db");
    const { or, like, isNull } = await import("drizzle-orm");
    const { findByCheckinToken } = await import("../services/checkin.service.js");
    // Simple portability helper (same pattern as services)
    const selectAll = async (query: unknown): Promise<unknown[]> => {
      const qq = query as Record<string, unknown>;
      if (typeof qq.all === "function") {
        const res = (qq.all as () => unknown)();
        const awaited = res instanceof Promise ? await res : res;
        if (Array.isArray(awaited)) return awaited;
        if (
          awaited &&
          typeof awaited === "object" &&
          "results" in (awaited as Record<string, unknown>)
        ) {
          return ((awaited as Record<string, unknown>).results as unknown[]) ?? [];
        }
        return Array.isArray(awaited) ? awaited : [];
      }
      const res = await (query as Promise<unknown>);
      if (Array.isArray(res)) return res;
      if (res && typeof res === "object" && "results" in (res as Record<string, unknown>)) {
        return ((res as Record<string, unknown>).results as unknown[]) ?? [];
      }
      return [];
    };
    let rows: unknown[];
    if (!q) {
      rows = await selectAll(
        db.select().from(registrations).where(isNull(registrations.deletedAt))
      );
    } else {
      rows = await selectAll(
        db
          .select()
          .from(registrations)
          .where(
            or(like(registrations.name, `%${q}%`), like(registrations.email, `%${q}%`)) as never
          )
      );
    }
    // Redact tokens from search results (PII hygiene §30.9)
    const results = (rows as Array<Record<string, unknown>>)
      .slice(0, 25)
      .map(({ checkinToken, ...rest }) => ({ ...rest, hasCheckinToken: Boolean(checkinToken) }));
    return c.json(
      {
        success: true as const,
        data: { results },
        meta: { count: results.length, query: q },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  };
  r.get("/v1/admin/checkin/search", requireAuth(), requireCheckinWrite(), searchHandler);
  r.get("/v1/check-in/search", requireAuth(), requireCheckinWrite(), searchHandler);

  return r;
}

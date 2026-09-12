import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { requireDb } from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { ApiError } from "../middleware/errorHandler.js";
import * as cfpReviewService from "../services/cfp-review.service.js";
import * as promotionService from "../services/promotion.service.js";
import type { AuthUser } from "../middleware/auth.js";
import { createLocalEmailPipeline } from "../jobs/emailConsumer.js";
import { resolveEmailQueue } from "../lib/queue.js";

// Best-effort local email pipeline for CFP decision emails (§19.3) — never fails the request
const { queue: decisionQueue, mailer: decisionMailer } = createLocalEmailPipeline();

/** Drizzle-agnostic select helper (better-sqlite3 sync vs D1 async). */
async function selectAll(query: unknown): Promise<unknown[]> {
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

// ---------------------------------------------------------------------------
// Zod schemas — boundary validation
// ---------------------------------------------------------------------------

const CfpAdminListQuerySchema = z.object({
  status: z.enum(["submitted", "under_review", "accepted", "rejected"]).optional(),
  eventId: z.string().min(1).max(128).optional(),
  event_id: z.string().min(1).max(128).optional(),
  q: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim())),
  offset: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim())),
});

const TransitionBodySchema = z
  .object({
    status: z.enum(["submitted", "under_review", "accepted", "rejected"]),
    comment: z.string().max(2000).optional(),
    score: z.number().int().min(1).max(5).optional(),
    // Allow score as string coerce
  })
  .superRefine((data, ctx) => {
    if (data.score !== undefined && !Number.isInteger(data.score)) {
      ctx.addIssue({ code: "custom", path: ["score"], message: "Score must be integer 1-5" });
    }
  });

const ReviewBodySchema = z.object({
  comment: z.string().max(2000).optional(),
  score: z.number().int().min(1).max(5).optional(),
});

function resolveEventId(query: Record<string, unknown>): string | undefined {
  const maybe = (query.eventId ?? query.event_id) as string | undefined;
  if (typeof maybe === "string" && maybe.trim().length > 0) return maybe.trim();
  return undefined;
}

function getClientIp(c: { req: { header(n: string): string | undefined } }): string | null {
  const cf = c.req.header("CF-Connecting-IP");
  if (cf && cf.trim().length > 0) return cf.trim();
  const xff = c.req.header("X-Forwarded-For");
  if (xff && xff.trim().length > 0) return xff.split(",")[0].trim();
  return null;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function cfpReviewRoutes() {
  const r = new Hono<AppEnv>();

  // Admin list — requires cfp:READ (WRITE implies READ)
  const listHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const raw = c.req.query() as Record<string, string>;
    // Validate via query schema manually to allow flexible handling
    const parsed = CfpAdminListQuerySchema.safeParse(raw);
    // If validation fails, we still want to return 400 — but for simplicity, if invalid status, return 400
    if (!parsed.success) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "Invalid query parameters",
        parsed.error.flatten().fieldErrors as Record<string, string[]>
      );
    }
    const q = parsed.data;
    const eventId = resolveEventId(q as unknown as Record<string, unknown>);
    const limit = q.limit ? Number(q.limit) : undefined;
    const offset = q.offset ? Number(q.offset) : undefined;
    const search = (q.search ?? q.q ?? undefined) as string | undefined;

    const rows = await cfpReviewService.listCfpSubmissions(db, {
      status: q.status,
      eventId,
      search,
      limit,
      offset,
    });

    return c.json({
      success: true as const,
      data: rows,
      meta: { count: rows.length },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // Detail — requires READ
  const detailHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const id = c.req.param("id") as string;
    const detail = await cfpReviewService.getCfpSubmissionDetail(db, id);
    return c.json({
      success: true as const,
      data: detail,
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // Transition — requires WRITE
  const transitionHandler = async (c: import("hono").Context<AppEnv>) => {
    const body = c.req.valid("json" as never) as z.infer<typeof TransitionBodySchema>;
    const db = requireDb(c);
    const user = c.get("user" as never) as AuthUser | undefined;
    const id = c.req.param("id") as string;
    const ip = getClientIp(c);
    const ua = c.req.header("User-Agent") ?? null;

    // score may arrive as string — coerce
    let score = body.score as number | undefined;
    if (typeof score === "string") {
      const n = Number(score);
      if (Number.isFinite(n)) score = n;
    }

    const result = await cfpReviewService.transitionCfpStatus(db, {
      submissionId: id,
      targetStatus: body.status as never,
      reviewerId: user?.id ?? null,
      comment: body.comment ?? null,
      score: score ?? null,
      ip,
      userAgent: ua,
    });

    // §19.3 — best-effort decision email to the primary speaker.
    // Accepted → NO email here: the approval email with session details is sent
    // when the promoted session is scheduled (§22.2 slot assignment).
    // Rejected → courteous rejection email.
    const target = body.status as string;
    if (target === "rejected") {
      void (async () => {
        try {
          const { cfpSubmissions, cfpSubmissionSpeakers } = await import("@pgegypt/db");
          const { eq, and, asc } = await import("drizzle-orm");
          const sub = (await selectAll(
            db.select().from(cfpSubmissions).where(eq(cfpSubmissions.id, id))
          )) as Array<{ title?: string; submitter_email?: string; submitterEmail?: string }>;
          const speakers = (await selectAll(
            db
              .select()
              .from(cfpSubmissionSpeakers)
              .where(
                and(
                  eq(cfpSubmissionSpeakers.submissionId, id),
                  eq(cfpSubmissionSpeakers.isPrimary, 1)
                )
              )
              .orderBy(asc(cfpSubmissionSpeakers.createdAt))
          )) as Array<{ email?: string; name?: string }>;
          const email = speakers[0]?.email ?? sub[0]?.submitterEmail ?? sub[0]?.submitter_email;
          const name = speakers[0]?.name ?? "there";
          const title = sub[0]?.title ?? "your proposal";
          if (email) {
            const job = {
              type: "cfp_status" as const,
              status: "rejected" as const,
              to: email,
              name,
              title,
              idempotencyKey: `cfp:${email.toLowerCase()}:${title}:rejected`,
            };
            const activeQueue = resolveEmailQueue(c.env as never) ?? decisionQueue;
            if (activeQueue && typeof activeQueue.enqueue === "function") {
              await activeQueue.enqueue(job);
            } else if (decisionMailer && typeof decisionMailer.send === "function") {
              // Direct-mailer fallback — build the template inline
              const { buildCfpRejectedEmail } = await import("@pgegypt/mail");
              const siteUrl = process.env.SITE_URL ?? "https://2026day.pgegypt.org";
              const tpl = buildCfpRejectedEmail({ name, title, siteUrl });
              const res = await decisionMailer.send({
                to: email,
                subject: tpl.subject,
                html: tpl.html,
                text: tpl.text,
              });
              if (!res.ok) console.error("[cfp] decision email failed (non-fatal):", res.error);
            }
          }
        } catch (err) {
          console.error(
            "[cfp] decision email failed (non-fatal):",
            err instanceof Error ? err.message : String(err)
          );
        }
      })();
    }

    return c.json({
      success: true as const,
      data: result.submission,
      meta: { reviewId: result.reviewId },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  };

  // Add review — requires WRITE
  const addReviewHandler = async (c: import("hono").Context<AppEnv>) => {
    const body = c.req.valid("json" as never) as z.infer<typeof ReviewBodySchema>;
    const db = requireDb(c);
    const user = c.get("user" as never) as AuthUser | undefined;
    const id = c.req.param("id") as string;
    const ip = getClientIp(c);
    const ua = c.req.header("User-Agent") ?? null;

    let score = body.score as number | undefined;
    if (typeof score === "string") {
      const n = Number(score);
      if (Number.isFinite(n)) score = n;
    }

    const review = await cfpReviewService.addCfpReview(db, {
      submissionId: id,
      reviewerId: user?.id ?? null,
      comment: body.comment ?? null,
      score: score ?? null,
      ip,
      userAgent: ua,
    });

    return c.json(
      {
        success: true as const,
        data: review,
        requestId: c.get("requestId" as never) as string | undefined,
      },
      201
    );
  };

  // Promote — requires WRITE, only accepted
  const promoteHandler = async (c: import("hono").Context<AppEnv>) => {
    const db = requireDb(c);
    const user = c.get("user" as never) as AuthUser | undefined;
    const id = c.req.param("id") as string;
    const ip = getClientIp(c);
    const ua = c.req.header("User-Agent") ?? null;

    const result = await promotionService.promoteSubmission(db, {
      submissionId: id,
      actorId: user?.id ?? null,
      ip,
      userAgent: ua,
    });

    return c.json(
      {
        success: true as const,
        data: {
          session: result.session,
          speakers: result.speakers,
          alreadyPromoted: result.alreadyPromoted,
        },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      result.alreadyPromoted ? 200 : 201
    );
  };

  // Mount — both /v1/admin/cfp and /v1/cfp aliases for spec compat
  // All admin routes require auth + cfp permission

  // List
  r.get("/v1/admin/cfp/submissions", requireAuth(), requirePermission("cfp:READ"), listHandler);
  r.get("/v1/cfp/submissions", requireAuth(), requirePermission("cfp:READ"), listHandler);

  // Detail — must register before patch/post to avoid param collision priority, but Hono handles
  r.get(
    "/v1/admin/cfp/submissions/:id",
    requireAuth(),
    requirePermission("cfp:READ"),
    detailHandler
  );
  r.get("/v1/cfp/submissions/:id", requireAuth(), requirePermission("cfp:READ"), detailHandler);

  // Transition — PATCH
  r.patch(
    "/v1/admin/cfp/submissions/:id",
    requireAuth(),
    requirePermission("cfp:WRITE"),
    validateJson(TransitionBodySchema),
    transitionHandler
  );
  r.patch(
    "/v1/cfp/submissions/:id",
    requireAuth(),
    requirePermission("cfp:WRITE"),
    validateJson(TransitionBodySchema),
    transitionHandler
  );

  // Reviews — POST
  r.post(
    "/v1/admin/cfp/submissions/:id/reviews",
    requireAuth(),
    requirePermission("cfp:WRITE"),
    validateJson(ReviewBodySchema),
    addReviewHandler
  );
  r.post(
    "/v1/cfp/submissions/:id/reviews",
    requireAuth(),
    requirePermission("cfp:WRITE"),
    validateJson(ReviewBodySchema),
    addReviewHandler
  );

  // Promote — POST
  r.post(
    "/v1/admin/cfp/submissions/:id/promote",
    requireAuth(),
    requirePermission("cfp:WRITE"),
    promoteHandler
  );
  r.post(
    "/v1/cfp/submissions/:id/promote",
    requireAuth(),
    requirePermission("cfp:WRITE"),
    promoteHandler
  );

  return r;
}

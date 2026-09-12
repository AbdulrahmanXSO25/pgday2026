import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../app.js";
import { validateJson, validateQuery } from "../lib/validate.js";
import { getDb } from "../lib/db.js";
import { ApiError } from "../middleware/errorHandler.js";
import { CfpSubmissionSchema, CfpMineQuerySchema } from "@pgegypt/validation";
import * as cfpService from "../services/cfp.service.js";
import * as mediaService from "../services/media.service.js";
import { getCfpClientIpFromHeaders } from "../repositories/cfp.repo.js";
import { createLocalEmailPipeline } from "../jobs/emailConsumer.js";
import { resolveEmailQueue } from "../lib/queue.js";
import { requireStorage } from "../lib/storage.js";

/**
 * CFP routes — §19, §26, §34
 * - POST /v1/cfp/submissions  public anonymous, Zod validated, IP rate limit 5/hour →429
 * - GET  /v1/cfp/submissions/mine?email=  public auth-lite, filters by submitterEmail lowercase
 *
 * Pure composition, DI via c.get('db'), explicit errors, status codes per api-design.md
 */

// Best-effort local email transport (in-process queue → Maildev in dev, Resend in prod via worker)
const { queue: localQueue, mailer: localMailer } = createLocalEmailPipeline();

function getClientIp(c: { req: { header(n: string): string | undefined } }): string {
  return getCfpClientIpFromHeaders({
    get: (n: string) => c.req.header(n) ?? null,
  });
}

export function cfpRoutes() {
  const r = new Hono<AppEnv>();

  // Public portrait presign — anonymous, rate-limited, speaker_photo only.
  // Lets CFP submitters upload a portrait directly to R2 (bytes never transit
  // the API). The submission then carries photoKey; cfp.service confirms it.
  r.post("/v1/cfp/presign", async (c: Context<AppEnv>) => {
    const db = getDb(c as Context<AppEnv>);
    if (!db) throw new ApiError(500, "INTERNAL_ERROR", "DB not available");
    const storage = requireStorage(c);
    const ip = getClientIp(c as { req: { header(n: string): string | undefined } });
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const payload = {
      filename: (body.filename ?? body.originalName ?? "") as string,
      mimeType: (body.mimeType ?? body.contentType ?? "") as string,
      size: Number(body.size ?? body.sizeBytes ?? 0),
      kind: "speaker_photo" as const,
      eventId: (body.eventId ?? undefined) as string | undefined,
      prefix: "cfp",
    };
    try {
      const result = await mediaService.createPresignedPut({
        db,
        storage,
        payload,
        uploaderId: undefined,
      });
      return c.json(
        {
          success: true as const,
          data: {
            id: result.id,
            key: result.key,
            storageKey: result.storageKey,
            url: result.url,
            expiresAt: result.expiresAt,
            expiresIn: result.expiresIn,
          },
          requestId: c.get("requestId" as never) as string | undefined,
        },
        201
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[cfp] presign failed:", msg.slice(0, 200));
      throw new ApiError(500, "INTERNAL_ERROR", "Failed to prepare portrait upload");
    }
  });

  // Public submit — anonymous, Zod boundary validation, rate-limited via DB
  r.post("/v1/cfp/submissions", validateJson(CfpSubmissionSchema), async (c: Context<AppEnv>) => {
    const payload = c.req.valid(
      "json" as never
    ) as import("@pgegypt/validation").CfpSubmissionPayload;
    const db = getDb(c as Context<AppEnv>);
    if (!db) throw new ApiError(500, "INTERNAL_ERROR", "DB not available");

    const ip = getClientIp(c as { req: { header(n: string): string | undefined } });

    // Optional idempotency token header — reserved for future, no-op now (§19 idempotent token optional)
    const idempotencyKey = c.req.header("Idempotency-Key") ?? c.req.header("x-idempotency-key");
    void idempotencyKey;

    const result = await cfpService.createCfpSubmission(
      {
        db,
        queue: (resolveEmailQueue(c.env as never) ?? localQueue) as never,
        mailer: localMailer as never,
        storage: requireStorage(c),
      },
      payload,
      ip
    );

    return c.json(
      {
        success: true as const,
        data: {
          id: result.id,
          email: result.email,
          eventId: result.eventId,
          status: "submitted" as const,
        },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      201
    );
  });

  // Public mine list — no auth, filtered by submitter email query param (auth-lite)
  // Must be registered BEFORE admin param routes to avoid collision
  r.get(
    "/v1/cfp/submissions/mine",
    validateQuery(CfpMineQuerySchema),
    async (c: Context<AppEnv>) => {
      const query = c.req.valid(
        "query" as never
      ) as import("@pgegypt/validation").CfpMineQueryPayload;
      const db = getDb(c as Context<AppEnv>);
      if (!db) throw new ApiError(500, "INTERNAL_ERROR", "DB not available");

      const data = await cfpService.listMine(db, query);

      return c.json({
        success: true as const,
        data,
        meta: { count: data.length },
        requestId: c.get("requestId" as never) as string | undefined,
      });
    }
  );

  // Legacy alias for mine — some clients may use /v1/cfp/mine
  r.get("/v1/cfp/mine", validateQuery(CfpMineQuerySchema), async (c: Context<AppEnv>) => {
    const query = c.req.valid(
      "query" as never
    ) as import("@pgegypt/validation").CfpMineQueryPayload;
    const db = getDb(c as Context<AppEnv>);
    if (!db) throw new ApiError(500, "INTERNAL_ERROR", "DB not available");
    const data = await cfpService.listMine(db, query);
    return c.json({
      success: true as const,
      data,
      meta: { count: data.length },
      requestId: c.get("requestId" as never) as string | undefined,
    });
  });

  return r;
}

import { createApp } from "./app.js";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@pgegypt/db";
import type { D1DatabaseLike } from "@pgegypt/db";
import { createR2StorageFromEnv } from "@pgegypt/storage";
/**
 * Cloudflare Workers entry — production (Phase 7).
 * Exports `fetch` and `queue` handlers.
 *
 * Local dev never uses wrangler dev — run `tsx watch src/index.ts` instead.
 * D1/R2/Queue bindings come from wrangler.jsonc (bindings), env vars via `vars`,
 * secrets via `wrangler secret put`.
 */

export type WorkerEnv = {
  DB: D1DatabaseLike;
  R2_BUCKET?: unknown;
  QUEUE?: { send: (msg: unknown) => Promise<void> };
  RUNTIME?: string;
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_BUCKET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  SITE_URL?: string;
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPO?: string;
  [key: string]: unknown;
};

// Drizzle D1 client — created once per isolate (module-level cache keyed by binding)
type D1Drizzle = ReturnType<typeof drizzle<typeof schema>>;
let cachedDb: D1Drizzle | null = null;

function createD1Db(env: WorkerEnv): D1Drizzle {
  if (cachedDb) return cachedDb;
  cachedDb = drizzle(env.DB as never, { schema }) as D1Drizzle;
  return cachedDb;
}

function buildApp(env: WorkerEnv) {
  const runtime = env.RUNTIME ?? "production";
  const db = createD1Db(env);
  const storage = createR2StorageFromEnv(env as unknown as Record<string, string | undefined>);
  return createApp({ db: db as never, storage, runtime });
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const app = buildApp(env);
    return app.fetch(request, env as never, ctx);
  },

  // Queue consumer for email jobs (§25) — Cloudflare Queue delivers at-least-once;
  // idempotencyKey dedup lives in the Resend mailer (Idempotency-Key header).
  async queue(
    batch: { messages: Array<{ body: unknown }> },
    env: WorkerEnv,
    _ctx: ExecutionContext
  ): Promise<void> {
    const { handleEmailBatch } = await import("./jobs/emailConsumer.js");
    const { createMailerFromEnv } = await import("@pgegypt/mail");
    const mailer = createMailerFromEnv(env as unknown as Record<string, string>);
    await handleEmailBatch(batch.messages as Array<{ body: unknown; id?: string }>, {
      mailer,
      siteUrl: (env as unknown as Record<string, string>).SITE_URL ?? "https://2026day.pgegypt.org",
    });
    void _ctx;
  },
};

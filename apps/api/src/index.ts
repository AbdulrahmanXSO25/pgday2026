import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createLocalClient } from "@pgegypt/db";
import { createR2StorageFromEnv } from "@pgegypt/storage";

/**
 * Node entry — plain Node, no wrangler/Miniflare.
 * Run locally via `pnpm --filter @pgegypt/api dev`  (tsx watch src/index.ts) on :8787
 * or `tsx src/index.ts`.
 *
 * DI: local SQLite file at DB_FILE / ./data/local.db resolved by @pgegypt/db.
 * Storage: S3-compatible adapter (MinIO :9000 by default) so browser presigned PUTs
 * work exactly as in production — falls back to the in-memory adapter when no
 * S3 endpoint is configured.
 * Prod path (Workers) uses D1 binding via worker.ts — never imported here.
 */

const port = Number(process.env.PORT ?? 8787);
const runtime = process.env.RUNTIME ?? process.env.NODE_ENV ?? "development";

// Attempt to create local DB — if file missing or better-sqlite3 not available,
// app still boots (routes will throw with DB-missing error, health still works).
let db: ReturnType<typeof createLocalClient>["db"] | undefined;
try {
  const client = createLocalClient();
  db = client.db;
} catch (err) {
  console.warn(
    `[api] local DB not available — running without db: ${String((err as Error).message)}`
  );
}

// Storage adapter — MinIO locally (docker compose), R2 in prod via env
let storage: ReturnType<typeof createR2StorageFromEnv> | undefined;
try {
  storage = createR2StorageFromEnv(process.env as Record<string, string | undefined>);
} catch (err) {
  console.warn(
    `[api] storage adapter unavailable — media routes will use memory fallback: ${String((err as Error).message)}`
  );
}

const app = createApp({ db, storage, runtime });

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`[api] listening on http://localhost:${info.port} (runtime=${runtime})`);
  }
);

export default app;

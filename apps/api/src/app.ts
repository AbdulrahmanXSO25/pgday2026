import { Hono } from "hono";
import type { Context, Next } from "hono";
import { logger } from "hono/logger";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { corsMiddleware } from "./middleware/cors.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { secureHeadersMiddleware } from "./middleware/secureHeaders.js";
import { csrfAdminMiddleware } from "./middleware/csrf.js";
import { dbMiddleware } from "./lib/db.js";
import { storageMiddleware } from "./lib/storage.js";
import { registerRoutes } from "./routes/index.js";
import type { Db } from "@pgegypt/db";
import type { AuthUser } from "./middleware/auth.js";
import type { StorageAdapter } from "@pgegypt/storage";

// ---------------------------------------------------------------------------
// Types — typed Variables + Bindings for Hono
// ---------------------------------------------------------------------------

export type AppVariables = {
  requestId: string;
  user?: AuthUser;
  db?: Db;
  storage?: StorageAdapter;
  // queue/mailer injected for handlers (reserved)
  runtime?: string;
};

export type AppBindings = {
  DB?: unknown; // D1DatabaseLike in prod
  R2_BUCKET?: unknown;
  QUEUE?: unknown;
  RUNTIME?: string;
};

export type AppEnv = {
  Variables: AppVariables;
  Bindings: AppBindings;
};

// ---------------------------------------------------------------------------
// Factory options — DI for adapters (local file vs D1/R2/Queue prod)
// ---------------------------------------------------------------------------

export type CreateAppOptions = {
  db?: Db;
  queue?: unknown;
  storage?: StorageAdapter;
  mailer?: unknown;
  runtime?: string;
};

// ---------------------------------------------------------------------------
// createApp — single Hono app imported by both Node and Workers entries
// ---------------------------------------------------------------------------

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<AppEnv>();

  // 1) Request ID must be first — downstream middleware/handlers depend on it
  app.use("*", requestIdMiddleware());

  // 2) Secure headers — CSP, HSTS, X-Frame-Options etc. Must be early to cover all responses
  app.use("*", secureHeadersMiddleware());

  // 3) Structured logger — after requestId so it can log the id
  //    hono/logger prints method/path/status/duration; keeps prod logs redacted
  app.use("*", logger());

  // 4) CORS — public routes open (no credentials), admin same-origin via proxy
  app.use("*", corsMiddleware());

  // 5) DI injection — db/storage made available via c.get('db') / c.get('storage')
  //    Routes never import better-sqlite3 or D1 or S3 directly.
  if (options.db) {
    app.use("*", dbMiddleware(options.db));
  }
  if (options.storage) {
    app.use("*", storageMiddleware(options.storage as StorageAdapter));
  }
  if (options.runtime) {
    // Always expose runtime — used by prod-only guards (test-header gating, CSRF)
    app.use("*", async (c: Context<AppEnv>, next: Next) => {
      c.set("runtime" as never, options.runtime as never);
      await next();
    });
  }

  // 6) Auth — resolves `c.get('user')`
  app.use("*", authMiddleware());

  // 6b) CSRF defense-in-depth — prod-only custom header on admin mutations (§30.2)
  app.use("*", csrfAdminMiddleware());

  // 7) Rate-limit — DB-backed later, sets headers now, does not block
  app.use("*", rateLimitMiddleware());

  // -----------------------------------------------------------------------
  // Routes — all §26 skeletons return 501 with auth guards placeholder
  // -----------------------------------------------------------------------
  registerRoutes(app);

  // -----------------------------------------------------------------------
  // 404 & error envelope — consistent {success, error, message, fieldErrors}
  // -----------------------------------------------------------------------
  app.notFound((c: Context<AppEnv>) => {
    const requestId = c.get("requestId") as string | undefined;
    return c.json(
      {
        success: false as const,
        error: "NOT_FOUND" as const,
        message: "Not Found",
        requestId,
      },
      404
    );
  });

  app.onError(errorHandler);

  return app;
}

export type App = ReturnType<typeof createApp>;

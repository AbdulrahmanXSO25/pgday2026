import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../app.js";
import { getDb } from "../lib/db.js";
import { rateLimits } from "@pgegypt/db";
import { eq } from "drizzle-orm";

/**
 * Health routes — liveness + DB probe.
 * `/v1/health` reports `db: "ok" | "error" | "unavailable"` so deploys can gate on it.
 */
export function healthRoutes() {
  const r = new Hono<AppEnv>();

  const dbProbe = async (c: Context<AppEnv>): Promise<"ok" | "error" | "unavailable"> => {
    const db = getDb(c);
    if (!db) return "unavailable";
    try {
      const q = db.select().from(rateLimits).where(eq(rateLimits.key, "__healthcheck__")).limit(1);
      const qq = q as unknown as { all?: () => unknown };
      if (typeof qq.all === "function") {
        qq.all();
      } else {
        await (q as unknown as Promise<unknown>);
      }
      return "ok";
    } catch {
      return "error";
    }
  };

  r.get("/health", (c: Context<AppEnv>) =>
    c.json({
      success: true as const,
      status: "ok",
      requestId: c.get("requestId" as never) as string | undefined,
    })
  );

  r.get("/v1/health", async (c: Context<AppEnv>) => {
    const db = await dbProbe(c);
    const ok = db === "ok" || db === "unavailable"; // unavailable only when no DB injected (local boot)
    return c.json(
      {
        success: true as const,
        status: ok ? ("ok" as const) : ("degraded" as const),
        version: "v1" as const,
        db,
        requestId: c.get("requestId" as never) as string | undefined,
      },
      ok ? 200 : 503
    );
  });

  return r;
}

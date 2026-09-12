import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import type { AppEnv } from "../app.js";
import { validateJson } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { getDb, requireDb } from "../lib/db.js";
import { ApiError } from "../middleware/errorHandler.js";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@pgegypt/auth";
import * as authService from "../services/auth.service.js";
import { isRateLimited, recordRateLimitHit, clearRateLimit } from "../lib/rate-limit.js";

// Failed-login throttling: 10 failures / 15 min per IP. Successful logins clear the counter,
// so legitimate organizers are never throttled by their own successful logins.
const LOGIN_FAIL_MAX = 10;
const LOGIN_FAIL_WINDOW_SEC = 15 * 60;

const LoginSchema = z.object({
  // Trim first, then validate email format (paste/autofill safety)
  email: z
    .string()
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().email()),
  // Passwords are matched after trimming surrounding whitespace — prevents paste/autofill
  // accidents (trailing spaces) while keeping internal characters exact. Admin credentials
  // are system-generated without edge whitespace, so this cannot lock anyone out.
  password: z.string().trim().min(1).max(128),
});

function getClientMeta(c: { req: { header(n: string): string | undefined } }): {
  ip: string;
  userAgent: string;
} {
  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const ua = c.req.header("user-agent") ?? "unknown";
  return { ip, userAgent: ua };
}

export function authRoutes() {
  const r = new Hono<AppEnv>();

  // POST /v1/auth/login — public, rate-limited at app level, sets cookie
  r.post("/v1/auth/login", validateJson(LoginSchema), async (c: Context<AppEnv>) => {
    const body = c.req.valid("json" as never) as { email: string; password: string };
    const db = getDb(c as Context<AppEnv>);
    if (!db) throw new ApiError(500, "INTERNAL_ERROR", "DB not available");

    const meta = getClientMeta(c as { req: { header(n: string): string | undefined } });
    const failKey = `login_fail:${meta.ip}`;

    // Brute-force protection — count failures only (§30.4)
    if (
      await isRateLimited(db, {
        key: failKey,
        max: LOGIN_FAIL_MAX,
        windowSec: LOGIN_FAIL_WINDOW_SEC,
      })
    ) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "Too many failed login attempts. Please try again later."
      );
    }

    let result: Awaited<ReturnType<typeof authService.login>>;
    try {
      result = await authService.login(db, { email: body.email, password: body.password }, meta);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await recordRateLimitHit(db, {
          key: failKey,
          max: LOGIN_FAIL_MAX,
          windowSec: LOGIN_FAIL_WINDOW_SEC,
        });
      }
      throw error;
    }
    await clearRateLimit(db, failKey);

    const isProd =
      (c.env as Record<string, unknown> | undefined)?.RUNTIME === "production" ||
      process.env.RUNTIME === "production" ||
      process.env.NODE_ENV === "production";

    setCookie(c, SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: Boolean(isProd) ? true : false,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
      expires: new Date(result.expiresAt * 1000),
    });

    return c.json(
      {
        success: true as const,
        data: {
          user: result.user,
          expiresAt: result.expiresAt,
          // Bearer token for cross-origin admin (static Pages) — cookie still set
          // for same-origin/proxy clients. Same session, either transport works.
          accessToken: result.token,
        },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  });

  // POST /v1/auth/logout — no auth required, always clears cookie (idempotent)
  r.post("/v1/auth/logout", async (c: Context<AppEnv>) => {
    const db = getDb(c as Context<AppEnv>);
    const token = getCookie(c as Context<AppEnv>, SESSION_COOKIE);
    // Also accept Bearer for tests
    const bearer = c.req.header("authorization")?.startsWith("Bearer ")
      ? c.req.header("authorization")!.slice(7).trim()
      : undefined;
    const rawToken = token ?? bearer;
    if (rawToken && db) {
      try {
        await authService.logout(db, rawToken);
      } catch {
        // ignore logout errors — still clear cookie
      }
    }

    // Clear cookie — set expired
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: false, httpOnly: true, sameSite: "Lax" });
    // Also ensure client sees cleared Set-Cookie with Max-Age 0
    setCookie(c, SESSION_COOKIE, "", {
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });

    return c.json(
      {
        success: true as const,
        message: "Logged out",
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  });

  // GET /v1/auth/me — requires auth, returns current user
  r.get("/v1/auth/me", requireAuth(), async (c: Context<AppEnv>) => {
    const user = c.get("user" as never) as
      | { id: string; email: string; displayName?: string; role: string; permissions: string[] }
      | undefined;
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
    return c.json(
      {
        success: true as const,
        data: { user },
        requestId: c.get("requestId" as never) as string | undefined,
      },
      200
    );
  });

  return r;
}

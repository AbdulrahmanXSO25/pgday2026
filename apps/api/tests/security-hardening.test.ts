/**
 * security-hardening.test.ts — P0 regressions
 * 1) X-Test-User auth injection MUST be ignored in production runtime.
 * 2) CSRF custom header MUST be required on /v1/admin/* mutations in production.
 */
import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

const testUser = JSON.stringify({
  id: "attacker",
  email: "attacker@example.com",
  role: "SUPER_ADMIN",
  permissions: [],
});

describe("P0 — production auth hardening", () => {
  it("ignores X-Test-User in production runtime (401, not an auth bypass)", async () => {
    const app = createApp({ runtime: "production" });
    const res = await app.request("/v1/admin/speakers", {
      headers: { "X-Test-User": testUser },
    });
    expect(res.status).toBe(401);
  });

  it("requires X-Requested-With: pgegypt-admin on admin mutations in production (403)", async () => {
    const app = createApp({ runtime: "production" });
    const res = await app.request("/v1/admin/speakers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "x", name: "X", bio: "long enough bio text" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("FORBIDDEN");
  });

  it("allows admin mutation with the CSRF header in production (reaches auth → 401 without session)", async () => {
    const app = createApp({ runtime: "production" });
    const res = await app.request("/v1/admin/speakers", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "pgegypt-admin" },
      body: JSON.stringify({ slug: "x", name: "X", bio: "long enough bio text" }),
    });
    // No session → 401 (not 403), proving CSRF gate passed
    expect(res.status).toBe(401);
  });

  it("does not enforce CSRF in development runtime (frictionless local)", async () => {
    const app = createApp({ runtime: "development" });
    const res = await app.request("/v1/admin/speakers", { method: "POST" });
    // No db → auth sets no user → 401; the point is it is NOT 403 from CSRF
    expect(res.status).toBe(401);
  });
});

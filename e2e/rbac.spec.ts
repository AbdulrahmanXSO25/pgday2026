/**
 * E2E — RBAC matrix §35.3, §40
 * Covers 9 modules, 2 roles, WRITE→READ invariant, SUPER_ADMIN bypass,
 * users/permissions & audit only SUPER_ADMIN.
 */
import { describe, it as test, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createTestDb, cleanupDb, cleanTables, testUserHeader } from "./helpers/db.js";
import { createApp } from "../apps/api/src/app.js";
import type { TestDb } from "./helpers/db.js";
const MODULES = [
  "events",
  "users",
  "speakers",
  "sessions",
  "sponsors",
  "registrations",
  "media",
  "cfp",
  "publishing",
] as const;

let tdb: TestDb;
beforeAll(() => {
  tdb = createTestDb("pgegypt-e2e-rbac-");
});
afterAll(() => cleanupDb(tdb));
beforeEach(() => cleanTables(tdb.sqlite));

const SUPER = testUserHeader("SUPER_ADMIN", []);
const NO_PERM = testUserHeader("ADMIN", []);

describe("E2E RBAC matrix — 9 modules × 2 roles", () => {
  test("SUPER_ADMIN bypasses all permission checks", async () => {
    const app = createApp({ db: tdb.db as never });
    const probes: Array<{ path: string; header: Record<string, string> }> = [
      { path: "/v1/admin/registrations", header: { "X-Test-User": SUPER } },
      { path: "/v1/admin/users", header: { "X-Test-User": SUPER } },
      { path: "/v1/admin/cfp/submissions", header: { "X-Test-User": SUPER } },
      { path: "/v1/publish", header: { "X-Test-User": SUPER } },
      { path: "/v1/admin/speakers", header: { "X-Test-User": SUPER } },
      { path: "/v1/admin/sessions", header: { "X-Test-User": SUPER } },
    ];
    for (const p of probes) {
      const res = await app.request(p.path, { headers: p.header });
      expect(res.status, `${p.path} should be 200 for SUPER_ADMIN`).toBe(200);
    }
  });

  test("ADMIN without permission gets 403, with READ gets 200, WRITE implies READ", async () => {
    const app = createApp({ db: tdb.db as never });
    // registrations:READ probe
    const noPermRes = await app.request("/v1/admin/registrations", {
      headers: { "X-Test-User": NO_PERM },
    });
    expect(noPermRes.status).toBe(403);

    const readOk = await app.request("/v1/admin/registrations", {
      headers: { "X-Test-User": testUserHeader("ADMIN", ["registrations:READ"]) },
    });
    expect(readOk.status).toBe(200);

    const writeImplies = await app.request("/v1/admin/registrations", {
      headers: { "X-Test-User": testUserHeader("ADMIN", ["registrations:WRITE"]) },
    });
    expect(writeImplies.status).toBe(200);
  });

  test("9 modules — each module READ/WRITE matrix behaves correctly", async () => {
    const app = createApp({ db: tdb.db as never });
    const moduleToPath: Record<string, { readPath: string; writePath?: string }> = {
      speakers: { readPath: "/v1/admin/speakers" },
      sessions: { readPath: "/v1/admin/sessions" },
      sponsors: { readPath: "/v1/admin/sponsors" },
      registrations: { readPath: "/v1/admin/registrations" },
      media: { readPath: "/v1/admin/media" },
      cfp: { readPath: "/v1/admin/cfp/submissions" },
      publishing: { readPath: "/v1/publish" },
      events: { readPath: "/v1/events" },
      users: { readPath: "/v1/admin/users" },
    };
    for (const mod of MODULES) {
      const probe = moduleToPath[mod];
      if (!probe) continue;
      const readPerm = `${mod}:READ` as string;
      const writePerm = `${mod}:WRITE` as string;
      // users/permissions/audit are SUPER_ADMIN only — even READ not enough for ADMIN, so expect 403
      if (mod === "users" || mod === "events") {
        const adminRead = await app.request(probe.readPath, {
          headers: { "X-Test-User": testUserHeader("ADMIN", [readPerm as never]) },
        });
        // users and events are SUPER_ADMIN gated, so ADMIN even with READ still 403
        expect([403, 404].includes(adminRead.status), `${mod} ADMIN READ should be forbidden`).toBe(
          true
        );
        continue;
      }
      const forbidden = await app.request(probe.readPath, { headers: { "X-Test-User": NO_PERM } });
      expect(forbidden.status, `${mod} no perm should 403`).toBe(403);
      const withRead = await app.request(probe.readPath, {
        headers: { "X-Test-User": testUserHeader("ADMIN", [readPerm as never]) },
      });
      expect(withRead.status, `${mod} read perm should 200`).toBe(200);
      const withWrite = await app.request(probe.readPath, {
        headers: { "X-Test-User": testUserHeader("ADMIN", [writePerm as never]) },
      });
      expect(withWrite.status, `${mod} write implies read should 200`).toBe(200);
    }
  });

  test("users/permissions & audit only SUPER_ADMIN — ADMIN gets 403", async () => {
    const app = createApp({ db: tdb.db as never });
    const adminWithPerms = testUserHeader("ADMIN", ["users:READ", "users:WRITE"]);
    for (const path of ["/v1/admin/users", "/v1/admin/permissions", "/v1/audit-logs"]) {
      const adminRes = await app.request(path, { headers: { "X-Test-User": adminWithPerms } });
      expect(adminRes.status, `${path} ADMIN 403`).toBe(403);
      const superRes = await app.request(path, { headers: { "X-Test-User": SUPER } });
      expect(superRes.status, `${path} SUPER 200`).toBe(200);
    }
  });

  test("unauthenticated returns 401", async () => {
    const app = createApp({ db: tdb.db as never });
    const res = await app.request("/v1/admin/registrations");
    expect(res.status).toBe(401);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("UNAUTHORIZED");
  });

  test("secure headers present on all responses", async () => {
    const app = createApp({ db: tdb.db as never });
    const res = await app.request("/v1/health", { headers: { "X-Test-User": SUPER } });
    // health may be public; fallback to admin route
    const r =
      res.status === 200
        ? res
        : await app.request("/v1/admin/registrations", { headers: { "X-Test-User": SUPER } });
    expect(r.headers.get("content-security-policy")).toBeTruthy();
    expect(r.headers.get("strict-transport-security")).toBeTruthy();
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-request-id")).toBeTruthy();
  });
});

/**
 * E2E — CFP lifecycle §40: submit → review → promote
 * Covers: public submit 201, validation, review transition, promotion to draft speaker/session.
 */
import { describe, it as test, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createTestDb, cleanupDb, cleanTables, testUserHeader, EVENT_ID } from "./helpers/db.js";
import { createApp } from "../apps/api/src/app.js";
import type { TestDb } from "./helpers/db.js";

let tdb: TestDb;

beforeAll(() => {
  tdb = createTestDb("pgegypt-e2e-cfp-");
});
afterAll(() => cleanupDb(tdb));
beforeEach(() => cleanTables(tdb.sqlite));

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Deep Dive into PostgreSQL Indexing",
    abstract:
      "A comprehensive session covering B-Tree, GIN, GiST, and BRIN indexes with real-world query plans, benchmarks and pitfalls.",
    track: "postgres-internals",
    level: "intermediate" as const,
    submitterName: "Alice Example",
    submitterEmail: "alice@example.com",
    submitterBio: "Postgres DBA for 5 years, organizer of local meetup.",
    coSpeakers: [],
    ...overrides,
  };
}

describe("E2E CFP submit→review→promote (§19-21, §40)", () => {
  test("submit happy 201 then review transitions then promote creates draft speaker/session", async () => {
    const app = createApp({ db: tdb.db as never });

    // 1) Public submit
    const submitRes = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.1.1" },
      body: JSON.stringify(validPayload()),
    });
    expect(submitRes.status).toBe(201);
    const submitBody = (await submitRes.json()) as Record<string, unknown>;
    const subId = (submitBody.data as Record<string, unknown>).id as string;
    expect(typeof subId).toBe("string");

    // 2) Admin list requires auth
    const unauth = await app.request("/v1/admin/cfp/submissions");
    expect(unauth.status).toBe(401);

    // 3) List with SUPER_ADMIN
    const list = await app.request("/v1/admin/cfp/submissions", {
      headers: { "X-Test-User": testUserHeader("SUPER_ADMIN", []) },
    });
    expect(list.status).toBe(200);

    // 4) Transition submitted → under_review
    const tr1 = await app.request(`/v1/admin/cfp/submissions/${subId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
      body: JSON.stringify({ status: "under_review", comment: "Looks promising" }),
    });
    expect(tr1.status).toBe(200);
    const tr1Body = (await tr1.json()) as Record<string, unknown>;
    expect((tr1Body.data as Record<string, unknown>).status).toBe("under_review");

    // 5) under_review → accepted
    const tr2 = await app.request(`/v1/admin/cfp/submissions/${subId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
      body: JSON.stringify({ status: "accepted", score: 5 }),
    });
    expect(tr2.status).toBe(200);

    // 6) Promote accepted → draft speaker + session
    const promote = await app.request(`/v1/admin/cfp/submissions/${subId}/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
    });
    expect([200, 201].includes(promote.status)).toBe(true);
    const promBody = (await promote.json()) as Record<string, unknown>;
    const promData = promBody.data as Record<string, unknown>;
    expect(promData.session).toBeDefined();
    expect(promData.speakers).toBeDefined();
    expect(Array.isArray(promData.speakers)).toBe(true);

    // Verify DB: speakers/sessions created as draft
    const speakerRow = tdb.sqlite
      .prepare(
        "SELECT id, is_draft FROM speakers WHERE slug LIKE 'alice-example%' OR name LIKE 'Alice%'"
      )
      .get() as { id: string; is_draft: number } | undefined;
    // At least one draft speaker exists
    const draftSpeakers = tdb.sqlite
      .prepare("SELECT count(*) as c FROM speakers WHERE is_draft=1")
      .get() as { c: number };
    expect(draftSpeakers.c).toBeGreaterThanOrEqual(1);
    const draftSessions = tdb.sqlite
      .prepare("SELECT count(*) as c FROM sessions WHERE is_draft=1")
      .get() as { c: number };
    expect(draftSessions.c).toBeGreaterThanOrEqual(1);

    // Re-promote idempotent → alreadyPromoted true
    const promote2 = await app.request(`/v1/admin/cfp/submissions/${subId}/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
      body: JSON.stringify({}),
    });
    expect(promote2.status).toBe(200);
    const pd2 = (await promote2.json()) as Record<string, unknown>;
    expect((pd2.data as Record<string, unknown>).alreadyPromoted).toBe(true);
  });

  test("CFP review add comment and score", async () => {
    const app = createApp({ db: tdb.db as never });
    const sr = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.2.1" },
      body: JSON.stringify(
        validPayload({ title: "Review Score Talk", submitterEmail: "reviewer@test.com" })
      ),
    });
    expect(sr.status).toBe(201);
    const id = ((await sr.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const subId = id.id as string;
    const rev = await app.request(`/v1/admin/cfp/submissions/${subId}/reviews`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
      body: JSON.stringify({ comment: "Great abstract", score: 4 }),
    });
    expect(rev.status).toBe(201);
  });

  test("cannot promote non-accepted submission → 409", async () => {
    const app = createApp({ db: tdb.db as never });
    const sr = await app.request("/v1/cfp/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.3.1" },
      body: JSON.stringify(
        validPayload({ title: "Not Accepted Talk", submitterEmail: "notacc@test.com" })
      ),
    });
    expect(sr.status).toBe(201);
    const subId = ((await sr.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const prom = await app.request(`/v1/admin/cfp/submissions/${subId.id as string}/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
    });
    expect(prom.status).toBe(409);
  });
});

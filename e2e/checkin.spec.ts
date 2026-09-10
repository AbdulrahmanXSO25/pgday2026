/**
 * E2E — Check-in §22, §40
 * Covers: happy check-in 200, idempotent repeat already_checked_in, reject non-confirmed 400, invalid 404.
 */
import { describe, it as test, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createTestDb, cleanupDb, cleanTables, testUserHeader } from "./helpers/db.js";
import { createApp } from "../apps/api/src/app.js";
import { createHash, randomUUID } from "node:crypto";
import type { TestDb } from "./helpers/db.js";

let tdb: TestDb;
beforeAll(() => {
  tdb = createTestDb("pgegypt-e2e-checkin-");
});
afterAll(() => cleanupDb(tdb));
beforeEach(() => cleanTables(tdb.sqlite));

const SUPER = testUserHeader("SUPER_ADMIN", []);
const WRITE = testUserHeader("ADMIN", ["registrations:WRITE"]);
const NO_PERM = testUserHeader("ADMIN", []);

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

async function createRegistration(payload: Record<string, unknown>) {
  const app = createApp({ db: tdb.db as never });
  return app.request("/v1/registrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("E2E check-in — §22", () => {
  test("happy: create → confirm → check-in 200, repeat already_checked_in", async () => {
    const reg = await createRegistration({
      name: "Alice Attendee",
      email: "alice@example.com",
      consent: true,
    });
    expect(reg.status).toBe(201);
    const regId = ((await reg.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const id = regId.id as string;

    const app = createApp({ db: tdb.db as never });
    const confirm = await app.request(`/v1/registrations/${id}/confirm`, {
      method: "POST",
      headers: { "X-Test-User": SUPER },
    });
    expect(confirm.status).toBe(200);
    const plain = ((await confirm.json()) as Record<string, unknown>).data as Record<
      string,
      unknown
    >;
    const token = plain.checkinToken as string;
    expect(token).toMatch(/^[0-9a-f-]{36}$/i);

    // DB stored hashed
    const row = tdb.sqlite.prepare("SELECT checkin_token FROM registrations WHERE id=?").get(id) as
      { checkin_token: string } | undefined;
    expect(row?.checkin_token).toBe(sha256(token));

    const first = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": WRITE },
      body: JSON.stringify({ token }),
    });
    expect(first.status).toBe(200);
    expect(
      ((await first.json()) as Record<string, unknown>).data as Record<string, unknown>
    ).toHaveProperty("status", "checked_in");

    const second = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": WRITE },
      body: JSON.stringify({ token }),
    });
    expect(second.status).toBe(200);
    expect(
      ((await second.json()) as Record<string, unknown>).data as Record<string, unknown>
    ).toHaveProperty("status", "already_checked_in");

    // alias also idempotent
    const third = await app.request("/v1/admin/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": WRITE },
      body: JSON.stringify({ token }),
    });
    expect(third.status).toBe(200);
  });

  test("reject non-confirmed pending token 400", async () => {
    const reg = await createRegistration({
      name: "Pending Pete",
      email: "pending@example.com",
      consent: true,
    });
    expect(reg.status).toBe(201);
    const id = ((await reg.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const fake = randomUUID();
    tdb.sqlite
      .prepare("UPDATE registrations SET checkin_token=? WHERE id=?")
      .run(sha256(fake), id.id as string);
    const app = createApp({ db: tdb.db as never });
    const res = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": WRITE },
      body: JSON.stringify({ token: fake }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("BAD_REQUEST");
  });

  test("invalid token 404", async () => {
    const app = createApp({ db: tdb.db as never });
    const res = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": WRITE },
      body: JSON.stringify({ token: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  test("RBAC: unauth 401, no perm 403, READ only 403, WRITE 200", async () => {
    const reg = await createRegistration({
      name: "RBAC Check",
      email: "rbac-check@example.com",
      consent: true,
    });
    expect(reg.status).toBe(201);
    const id = ((await reg.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const app = createApp({ db: tdb.db as never });
    const conf = await app.request(`/v1/registrations/${id.id as string}/confirm`, {
      method: "POST",
      headers: { "X-Test-User": SUPER },
    });
    const token = ((await conf.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const plain = token.checkinToken as string;

    const unauth = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: plain }),
    });
    expect(unauth.status).toBe(401);

    const noPerm = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": NO_PERM },
      body: JSON.stringify({ token: plain }),
    });
    expect(noPerm.status).toBe(403);

    const readOnly = await app.request("/v1/check-in", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("ADMIN", ["registrations:READ"]),
      },
      body: JSON.stringify({ token: plain }),
    });
    expect(readOnly.status).toBe(403);

    // Fresh token for WRITE check to avoid already_checked_in side-effect
    const reg2 = await createRegistration({
      name: "RBAC Write",
      email: "rbac-write2@example.com",
      consent: true,
    });
    const id2 = ((await reg2.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const conf2 = await app.request(`/v1/registrations/${id2.id as string}/confirm`, {
      method: "POST",
      headers: { "X-Test-User": SUPER },
    });
    const tok2 = ((await conf2.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const ok = await app.request("/v1/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": WRITE },
      body: JSON.stringify({ token: tok2.checkinToken as string }),
    });
    expect(ok.status).toBe(200);
  });
});

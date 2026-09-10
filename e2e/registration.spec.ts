/**
 * E2E — Registration §40
 * Playwright spec covering: happy 201, duplicate 409, rateLimit 429.
 * Uses Hono app.request against real SQLite (no external server needed).
 */
import { describe, it as test, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createTestDb, cleanupDb, cleanTables, EVENT_ID } from "./helpers/db.js";
import { createApp } from "../apps/api/src/app.js";
import type { TestDb } from "./helpers/db.js";

let tdb: TestDb;

beforeAll(() => {
  tdb = createTestDb("pgegypt-e2e-reg-");
});

afterAll(() => cleanupDb(tdb));
beforeEach(() => cleanTables(tdb.sqlite));

describe("E2E registration — §40", () => {
  test("happy path creates registration 201 with lowercased email", async () => {
    const app = createApp({ db: tdb.db as never });
    const res = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.1.1" },
      body: JSON.stringify({ name: "Alice Example", email: "Alice@Example.COM", consent: true }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    const data = body.data as Record<string, unknown>;
    expect(data.email).toBe("alice@example.com");
    expect(data.eventId).toBe(EVENT_ID);
    expect(typeof data.id).toBe("string");
    const row = tdb.sqlite
      .prepare("SELECT email FROM registrations WHERE id=?")
      .get(data.id as string) as { email: string } | undefined;
    expect(row?.email).toBe("alice@example.com");
  });

  test("duplicate 409 with friendly message", async () => {
    const app = createApp({ db: tdb.db as never });
    const payload = { name: "Bob Dup", email: "bob@example.com", consent: true };
    const r1 = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "2.2.2.2" },
      body: JSON.stringify(payload),
    });
    expect(r1.status).toBe(201);
    const r2 = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "2.2.2.3" },
      body: JSON.stringify(payload),
    });
    expect(r2.status).toBe(409);
    const b2 = (await r2.json()) as Record<string, unknown>;
    expect(b2.error).toBe("CONFLICT");
    expect(String(b2.message)).toMatch(/already registered/i);
  });

  test("rateLimit 429 after 5/hour per IP, isolated per IP", async () => {
    const app = createApp({ db: tdb.db as never });
    const ip = "10.0.0.1";
    for (let i = 0; i < 5; i++) {
      const r = await app.request("/v1/registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({ name: `User ${i}`, email: `rl${i}@example.com`, consent: true }),
      });
      expect(r.status, `attempt ${i}`).toBe(201);
    }
    const limited = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ name: "User 6", email: "rl5@example.com", consent: true }),
    });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as Record<string, unknown>).error).toBe("RATE_LIMITED");

    const otherOk = await app.request("/v1/registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.0.0.2" },
      body: JSON.stringify({ name: "Other", email: "other@example.com", consent: true }),
    });
    expect(otherOk.status).toBe(201);
  });

  test("parallel duplicate race → one 201 one 409, DB has exactly 1", async () => {
    const app = createApp({ db: tdb.db as never });
    const payload = { name: "Race Runner", email: "race@example.com", consent: true };
    const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "3.3.3.3" } as Record<
      string,
      string
    >;
    const [a, b] = await Promise.all([
      app.request("/v1/registrations", { method: "POST", headers, body: JSON.stringify(payload) }),
      app.request("/v1/registrations", { method: "POST", headers, body: JSON.stringify(payload) }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const count = (
      tdb.sqlite
        .prepare("SELECT count(*) as c FROM registrations WHERE email='race@example.com'")
        .get() as { c: number }
    ).c;
    expect(count).toBe(1);
  });
});

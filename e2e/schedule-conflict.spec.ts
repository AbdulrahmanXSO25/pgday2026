/**
 * E2E — Schedule conflict §24, §40
 * Overlap in same room → 409, different room OK, adjacent non-overlapping OK.
 */
import { describe, it as test, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createTestDb, cleanupDb, cleanTables, testUserHeader, EVENT_ID } from "./helpers/db.js";
import { createApp } from "../apps/api/src/app.js";
import type { TestDb } from "./helpers/db.js";

let tdb: TestDb;
let ROOM_A: string;
let ROOM_B: string;

beforeAll(() => {
  tdb = createTestDb("pgegypt-e2e-sched-");
  // Seed rooms
  ROOM_A = crypto.randomUUID();
  ROOM_B = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  tdb.sqlite
    .prepare(
      "INSERT OR IGNORE INTO rooms (id, event_id, slug, name, capacity, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(ROOM_A, EVENT_ID, "e2e-room-a", "E2E Room A", 300, 0, now, now);
  tdb.sqlite
    .prepare(
      "INSERT OR IGNORE INTO rooms (id, event_id, slug, name, capacity, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(ROOM_B, EVENT_ID, "e2e-room-b", "E2E Room B", 100, 1, now, now);
});
afterAll(() => cleanupDb(tdb));
beforeEach(() => {
  for (const t of ["session_speakers", "sessions"]) {
    try {
      tdb.sqlite.prepare(`DELETE FROM ${t}`).run();
    } catch {}
  }
});

const SESSIONS_WRITE = testUserHeader("ADMIN", ["sessions:WRITE"]);

async function createSession(payload: Record<string, unknown>) {
  const app = createApp({ db: tdb.db as never });
  return app.request("/v1/admin/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Test-User": SESSIONS_WRITE },
    body: JSON.stringify(payload),
  });
}

describe("E2E schedule conflict — §24", () => {
  test("same room overlapping returns 409 CONFLICT", async () => {
    const r1 = await createSession({
      slug: "first-session",
      title: "First Session Title Here",
      roomId: ROOM_A,
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
    });
    expect(r1.status).toBe(201);
    const overlap = await createSession({
      slug: "overlap-session",
      title: "Overlap Session Title Here",
      roomId: ROOM_A,
      startsAt: "2026-10-10T09:30:00.000Z",
      endsAt: "2026-10-10T10:30:00.000Z",
    });
    expect(overlap.status).toBe(409);
    const body = (await overlap.json()) as Record<string, unknown>;
    expect(body.error).toBe("CONFLICT");
  });

  test("different room same time succeeds 201", async () => {
    const r1 = await createSession({
      slug: "room-a-session",
      title: "Room A Session Title Here",
      roomId: ROOM_A,
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
    });
    expect(r1.status).toBe(201);
    const r2 = await createSession({
      slug: "room-b-session",
      title: "Room B Session Title Here",
      roomId: ROOM_B,
      startsAt: "2026-10-10T09:30:00.000Z",
      endsAt: "2026-10-10T10:30:00.000Z",
    });
    expect(r2.status).toBe(201);
  });

  test("adjacent end-exclusive non-overlap succeeds, 1-minute overlap fails", async () => {
    const first = await createSession({
      slug: "adj-first",
      title: "Adjacent First Session Title",
      roomId: ROOM_A,
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
    });
    expect(first.status).toBe(201);
    const adj = await createSession({
      slug: "adj-second",
      title: "Adjacent Second Session Title",
      roomId: ROOM_A,
      startsAt: "2026-10-10T10:00:00.000Z",
      endsAt: "2026-10-10T11:00:00.000Z",
    });
    expect(adj.status).toBe(201);
    const overlap = await createSession({
      slug: "adj-overlap",
      title: "Adjacent Overlap Session Title",
      roomId: ROOM_A,
      startsAt: "2026-10-10T09:59:00.000Z",
      endsAt: "2026-10-10T10:30:00.000Z",
    });
    expect(overlap.status).toBe(409);
  });

  test("epoch overlap detection also 409", async () => {
    const first = await createSession({
      slug: "epoch-first",
      title: "Epoch First Session Title",
      roomId: ROOM_A,
      startsAtEpoch: Math.floor(Date.parse("2026-10-10T09:00:00.000Z") / 1000),
      endsAtEpoch: Math.floor(Date.parse("2026-10-10T10:00:00.000Z") / 1000),
    });
    expect(first.status).toBe(201);
    const overlap = await createSession({
      slug: "epoch-overlap",
      title: "Epoch Overlap Session Title",
      roomId: ROOM_A,
      startsAtEpoch: Math.floor(Date.parse("2026-10-10T09:30:00.000Z") / 1000),
      endsAtEpoch: Math.floor(Date.parse("2026-10-10T10:30:00.000Z") / 1000),
    });
    expect(overlap.status).toBe(409);
  });

  test("updating to overlapping time returns 409", async () => {
    const s1 = await createSession({
      slug: "upd-first",
      title: "Updatable First Session Title",
      roomId: ROOM_A,
      startsAt: "2026-10-10T09:00:00.000Z",
      endsAt: "2026-10-10T10:00:00.000Z",
    });
    expect(s1.status).toBe(201);
    const s2 = await createSession({
      slug: "upd-second",
      title: "Updatable Second Session Title",
      roomId: ROOM_A,
      startsAt: "2026-10-10T11:00:00.000Z",
      endsAt: "2026-10-10T12:00:00.000Z",
    });
    expect(s2.status).toBe(201);
    const sid2 = ((await s2.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const app = createApp({ db: tdb.db as never });
    const upd = await app.request(`/v1/admin/sessions/${sid2.id as string}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Test-User": SESSIONS_WRITE },
      body: JSON.stringify({
        startsAt: "2026-10-10T09:30:00.000Z",
        endsAt: "2026-10-10T10:30:00.000Z",
      }),
    });
    expect(upd.status).toBe(409);
  });
});

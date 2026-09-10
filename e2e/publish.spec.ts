/**
 * E2E — Publish pipeline §16, §40
 * Covers: publish writes content/*.json, public-web rebuild succeeds, idempotent,
 * venue TBA never fabricated, auth.
 */
import { describe, it as test, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createTestDb, cleanupDb, cleanTables, testUserHeader, EVENT_ID } from "./helpers/db.js";
import { createApp } from "../apps/api/src/app.js";
import type { TestDb } from "./helpers/db.js";
import { existsSync, readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tdb: TestDb;
let publishDir: string;
let origPublishDir: string | undefined;

beforeAll(() => {
  tdb = createTestDb("pgegypt-e2e-publish-");
  publishDir = mkdtempSync(join(tmpdir(), "pgegypt-publish-e2e-"));
  origPublishDir = process.env.PUBLISH_DIR;
  process.env.PUBLISH_DIR = publishDir;
});
afterAll(() => {
  if (origPublishDir !== undefined) process.env.PUBLISH_DIR = origPublishDir;
  else delete process.env.PUBLISH_DIR;
  cleanupDb(tdb);
  try {
    rmSync(publishDir, { recursive: true, force: true });
  } catch {}
});
beforeEach(() => {
  cleanTables(tdb.sqlite);
  process.env.PUBLISH_DIR = publishDir;
  try {
    for (const f of readdirSync(publishDir)) rmSync(join(publishDir, f), { force: true });
  } catch {}
});

describe("E2E publish — §16", () => {
  test("publish requires auth and publishing:WRITE, SUPER_ADMIN can publish", async () => {
    const app = createApp({ db: tdb.db as never });
    const unauth = await app.request("/v1/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(unauth.status).toBe(401);
    const noPerm = await app.request("/v1/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test-User": testUserHeader("ADMIN", []) },
      body: JSON.stringify({}),
    });
    expect(noPerm.status).toBe(403);
    const ok = await app.request("/v1/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
      body: JSON.stringify({}),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
  });

  test("publish writes content/*.json and is idempotent; second call same hash no new row", async () => {
    // Seed minimal speaker for assembly
    const now = Math.floor(Date.now() / 1000);
    tdb.sqlite
      .prepare(
        "INSERT INTO speakers (id, event_id, slug, name, role, company, bio, photo_url, is_draft, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
      )
      .run(
        `spk_${crypto.randomUUID()}`,
        EVENT_ID,
        "seed-speaker",
        "Seed Speaker",
        "Engineer",
        "Acme",
        "Bio long enough for validation",
        null,
        0,
        now,
        now
      );

    const app = createApp({ db: tdb.db as never });
    const r1 = await app.request("/v1/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
      body: JSON.stringify({}),
    });
    expect(r1.status).toBe(200);
    const d1 = (await r1.json()) as Record<string, unknown>;
    const data1 = d1.data as Record<string, unknown>;
    expect(typeof data1.contentHash).toBe("string");
    // Check files written
    for (const f of [
      "site-config.json",
      "speakers.json",
      "schedule.json",
      "sponsors.json",
      "organizers.json",
      "faq.json",
    ]) {
      expect(existsSync(join(publishDir, f)), f).toBe(true);
      const raw = readFileSync(join(publishDir, f), "utf-8");
      expect(() => JSON.parse(raw), f).not.toThrow();
    }
    const count1 = (
      tdb.sqlite.prepare("SELECT count(*) as c FROM publications").get() as { c: number }
    ).c;
    const r2 = await app.request("/v1/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
      body: JSON.stringify({}),
    });
    expect(r2.status).toBe(200);
    const d2 = (await r2.json()) as Record<string, unknown>;
    const data2 = d2.data as Record<string, unknown>;
    expect(data2.contentHash).toBe(data1.contentHash);
    expect(data2.id).toBe(data1.id);
    const count2 = (
      tdb.sqlite.prepare("SELECT count(*) as c FROM publications").get() as { c: number }
    ).c;
    expect(count2).toBe(count1);
  });

  test("venue TBA never fabricated — site-config keeps venueName null", async () => {
    tdb.sqlite
      .prepare(
        "UPDATE events SET venue_status='tba', venue_name=NULL, venue_address=NULL WHERE id=?"
      )
      .run(EVENT_ID);
    const app = createApp({ db: tdb.db as never });
    const r = await app.request("/v1/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(200);
    const siteRaw = readFileSync(join(publishDir, "site-config.json"), "utf-8");
    const site = JSON.parse(siteRaw) as Record<string, unknown>;
    const event = site.event as Record<string, unknown>;
    expect(event.venueStatus).toBe("tba");
    expect(event.venueName).toBeNull();
    expect(event.venueAddress).toBeNull();
  });

  test("public-web rebuild succeeds from published content (content-source reads publish dir when present)", async () => {
    tdb.sqlite
      .prepare(
        "UPDATE events SET venue_status='confirmed', venue_name='Cairo Center', venue_address='Nasr City' WHERE id=?"
      )
      .run(EVENT_ID);
    const app = createApp({ db: tdb.db as never });
    await app.request("/v1/publish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-User": testUserHeader("SUPER_ADMIN", []),
      },
      body: JSON.stringify({}),
    });
    // Verify content-source prefers publish dir
    const { __clearContentCache, getSiteConfig, getSpeakers } =
      await import("../apps/public-web/lib/content-source.js");
    (__clearContentCache as () => void)();
    const cfg = (getSiteConfig as () => Record<string, unknown>)() as unknown as {
      event: { venueStatus: string; venueName: string | null };
    };
    expect(cfg.event.venueName).toBe("Cairo Center");
    const speakers = (getSpeakers as () => unknown[])();
    expect(Array.isArray(speakers)).toBe(true);
    (__clearContentCache as () => void)();
  });
});

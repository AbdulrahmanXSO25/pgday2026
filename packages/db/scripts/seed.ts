/**
 * seed.ts — loads site-config + speakers/schedule/sponsors into DB faithfully.
 * Reads from apps/public-web/content/*.json or root content/*.json (fallback).
 * Ensures path works from packages/db perspective and from repo root.
 *
 * Usage:
 *   pnpm --filter @pgegypt/db exec tsx scripts/seed.ts
 *   DB_FILE=./data/local.db pnpm --filter @pgegypt/db exec tsx scripts/seed.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

type SeedOptions = {
  dbFile: string;
  contentDir?: string;
};

const DEFAULT_DB_FILE = process.env.DB_FILE ?? "./data/local.db";

function resolveDbFile(explicit?: string): string {
  if (explicit) return explicit;
  return process.env.DB_FILE ?? DEFAULT_DB_FILE;
}

function resolveContentDir(): string {
  const candidates = [
    process.env.CONTENT_DIR,
    resolve(process.cwd(), "apps/public-web/content"),
    resolve(process.cwd(), "../../apps/public-web/content"),
    resolve(process.cwd(), "content"),
    resolve(process.cwd(), "../../content"),
    join(resolve(dirnameOfImportMeta()), "../../../content"),
    join(resolve(dirnameOfImportMeta()), "../../../apps/public-web/content"),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(c) && existsSync(join(c, "site-config.json"))) return resolve(c);
  }
  // Fallback to first candidate
  return resolve(candidates[0] ?? "./content");
}

function dirnameOfImportMeta(): string {
  try {
    return new URL(".", import.meta.url).pathname;
  } catch {
    return process.cwd();
  }
}

function readJson<T>(dir: string, file: string): T {
  const full = join(dir, file);
  if (!existsSync(full)) {
    throw new Error(`Missing content file: ${full}`);
  }
  const raw = readFileSync(full, "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Invalid JSON in ${full}: ${String((error as Error).message)}`);
  }
}

type SiteConfig = {
  event: {
    name: string;
    tagline: string;
    date: string;
    dateDisplay: string;
    city: string;
    venueStatus: string;
    venueName: string | null;
    venueAddress: string | null;
    timezone: string;
  };
  organizer: { name: string; contactEmail: string };
  features: { showSponsors: boolean; showCountdown: boolean };
  social: { twitter: string | null; linkedin: string | null; youtube: string | null };
  registration: { open: boolean; closedMessage: string };
};

type SpeakerJson = {
  id: string;
  name: string;
  role: string;
  company: string;
  bio: string;
  photo: string;
  social: { linkedin: string | null; twitter: string | null };
  talkId: string;
};

type ScheduleJson = {
  id: string;
  start: string;
  end: string;
  title: string;
  type: "talk" | "keynote" | "panel" | "break" | "logistics";
  level?: "beginner" | "intermediate" | "advanced" | null;
  abstract?: string;
  speakerIds: string[];
};

type SponsorJson = {
  id: string;
  name: string;
  tier: "platinum" | "gold" | "silver" | "community";
  logo: string;
  url: string;
  visible: boolean;
};

function generateUuidV7Placeholder(prefix: string, slug: string): string {
  // Deterministic UUIDv7-like placeholder for seed — not cryptographic, but stable for tests.
  // Uses a simple hash of slug to fill suffix so repeated seeds are idempotent via INSERT OR REPLACE.
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  const hex = hash.toString(16).padStart(8, "0");
  return `${prefix}_${slug}-${hex}`.slice(0, 64);
}

function toEpochSeconds(timeStr: string, dateStr: string): number | null {
  // Convert "09:45" on dateStr "2026-10-10" Africa/Cairo to unix epoch.
  // Africa/Cairo is UTC+2 (EET) / UTC+3 (EEST DST). Oct is UTC+2. Use +02:00 offset.
  // Keep simple: interpret as 02:00 offset.
  if (!timeStr || !dateStr) return null;
  const iso = `${dateStr}T${timeStr}:00+02:00`;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

export function seed(options: SeedOptions): {
  eventId: string;
  speakers: number;
  sessions: number;
  sponsors: number;
  rooms: number;
} {
  const dbFile = resolve(options.dbFile);
  const contentDir = options.contentDir ? resolve(options.contentDir) : resolveContentDir();

  const siteConfig = readJson<SiteConfig>(contentDir, "site-config.json");
  const speakersRaw = readJson<SpeakerJson[]>(contentDir, "speakers.json");
  const scheduleRaw = readJson<ScheduleJson[]>(contentDir, "schedule.json");
  const sponsorsRaw = readJson<SponsorJson[]>(contentDir, "sponsors.json");

  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    const eventId = "evt_00000000-0000-7000-8000-000000000001";
    const eventSlug = "pgegypt-2026";

    const upsertEvent = db.prepare(`
      INSERT INTO events (id, slug, name, tagline, date, date_display, city, venue_status, venue_name, venue_address, timezone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        slug=excluded.slug, name=excluded.name, tagline=excluded.tagline, date=excluded.date,
        date_display=excluded.date_display, city=excluded.city, venue_status=excluded.venue_status,
        venue_name=excluded.venue_name, venue_address=excluded.venue_address, timezone=excluded.timezone,
        updated_at=unixepoch()
    `);
    upsertEvent.run(
      eventId,
      eventSlug,
      siteConfig.event.name,
      siteConfig.event.tagline,
      siteConfig.event.date,
      siteConfig.event.dateDisplay,
      siteConfig.event.city,
      siteConfig.event.venueStatus ?? "tba",
      siteConfig.event.venueName,
      siteConfig.event.venueAddress,
      siteConfig.event.timezone ?? "Africa/Cairo"
    );

    // Ensure default room exists
    const roomId = "room_00000000-0000-7000-8000-000000000001";
    db.prepare(
      `INSERT OR IGNORE INTO rooms (id, event_id, slug, name, capacity, sort_order) VALUES (?, ?, 'main-hall','Main Hall',300,0)`
    ).run(roomId, eventId);

    // Seed speakers
    let speakerCount = 0;
    const speakerStmt = db.prepare(`
      INSERT INTO speakers (id, event_id, slug, name, role, company, bio, photo_url, linkedin, twitter, is_draft, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, unixepoch(), unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        slug=excluded.slug, name=excluded.name, role=excluded.role, company=excluded.company,
        bio=excluded.bio, photo_url=excluded.photo_url, linkedin=excluded.linkedin, twitter=excluded.twitter,
        updated_at=unixepoch()
    `);
    const speakerTx = db.transaction(() => {
      for (const s of speakersRaw) {
        const id = `spk_${s.id}`;
        speakerStmt.run(
          id,
          eventId,
          s.id,
          s.name,
          s.role,
          s.company,
          s.bio,
          s.photo,
          s.social.linkedin,
          s.social.twitter
        );
        speakerCount++;
      }
    });
    speakerTx();

    // Seed sponsors
    let sponsorCount = 0;
    const sponsorStmt = db.prepare(`
      INSERT INTO sponsors (id, event_id, slug, name, tier, logo_url, url, visible, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        slug=excluded.slug, name=excluded.name, tier=excluded.tier, logo_url=excluded.logo_url,
        url=excluded.url, visible=excluded.visible, sort_order=excluded.sort_order, updated_at=unixepoch()
    `);
    const tierOrder: Record<string, number> = { platinum: 0, gold: 1, silver: 2, community: 3 };
    const sponsorTx = db.transaction(() => {
      for (const sp of sponsorsRaw) {
        const id = `spon_${sp.id}`;
        sponsorStmt.run(
          id,
          eventId,
          sp.id,
          sp.name,
          sp.tier,
          sp.logo,
          sp.url,
          sp.visible ? 1 : 0,
          tierOrder[sp.tier] ?? 99
        );
        sponsorCount++;
      }
    });
    sponsorTx();

    // Seed sessions (schedule) + session_speakers join
    let sessionCount = 0;
    const sessionStmt = db.prepare(`
      INSERT INTO sessions (id, event_id, room_id, slug, title, type, level, abstract, starts_at, ends_at, starts_at_epoch, ends_at_epoch, is_draft, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'published', unixepoch(), unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, type=excluded.type, level=excluded.level, abstract=excluded.abstract,
        starts_at=excluded.starts_at, ends_at=excluded.ends_at, starts_at_epoch=excluded.starts_at_epoch,
        ends_at_epoch=excluded.ends_at_epoch, room_id=excluded.room_id, updated_at=unixepoch()
    `);

    const clearJoin = db.prepare("DELETE FROM session_speakers WHERE session_id = ?");
    const insertJoin = db.prepare(
      "INSERT OR IGNORE INTO session_speakers (session_id, speaker_id) VALUES (?, ?)"
    );

    const sessionTx = db.transaction(() => {
      for (const item of scheduleRaw) {
        const id = `sess_${item.id}`;
        const startsEpoch = toEpochSeconds(item.start, siteConfig.event.date);
        const endsEpoch = toEpochSeconds(item.end, siteConfig.event.date);
        // Non-talk items (break/logistics) have no room assignment; talks go to main hall
        const room =
          item.type === "talk" || item.type === "keynote" || item.type === "panel" ? roomId : null;
        sessionStmt.run(
          id,
          eventId,
          room,
          item.id,
          item.title,
          item.type,
          item.level ?? null,
          item.abstract ?? null,
          item.start,
          item.end,
          startsEpoch,
          endsEpoch
        );
        clearJoin.run(id);
        for (const spId of item.speakerIds) {
          insertJoin.run(id, `spk_${spId}`);
        }
        sessionCount++;
      }
    });
    sessionTx();

    return {
      eventId,
      speakers: speakerCount,
      sessions: sessionCount,
      sponsors: sponsorCount,
      rooms: 1,
    };
  } finally {
    db.close();
  }
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbFile = resolveDbFile();
  try {
    const contentDir = resolveContentDir();
    console.log(`[seed] DB: ${resolve(dbFile)}`);
    console.log(`[seed] Content: ${contentDir}`);
    const result = seed({ dbFile, contentDir });
    console.log(`[seed] Event: ${result.eventId}`);
    console.log(
      `[seed] Speakers: ${result.speakers}, Sessions: ${result.sessions}, Sponsors: ${result.sponsors}, Rooms: ${result.rooms}`
    );
    console.log("[seed] Done.");
  } catch (error) {
    console.error("[seed] Failed:", (error as Error).message);
    console.error((error as Error).stack);
    process.exit(1);
  }
}

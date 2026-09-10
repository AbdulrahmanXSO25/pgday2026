/**
 * Content source — fallback vs publish dir (§6, §16).
 * public-web imports from committed fallback if publish dir missing, else from publish dir.
 * Zero fetch to api at request time — all reads are from JSON files on disk.
 * Venue TBA never fabricated (§16) — when venueStatus is tba, venueName/Address stay null and UI/JSON-LD omit location.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas — same as packages/publish assemble for validation
// ---------------------------------------------------------------------------

export const SiteConfigSchema = z.object({
  event: z.object({
    name: z.string(),
    tagline: z.string(),
    date: z.string(),
    dateDisplay: z.string(),
    city: z.string(),
    venueStatus: z.enum(["tba", "confirmed"]),
    venueName: z.string().nullable(),
    venueAddress: z.string().nullable(),
    timezone: z.string(),
  }),
  organizer: z.object({
    name: z.string(),
    contactEmail: z.string().email(),
  }),
  features: z.object({
    showSponsors: z.boolean(),
    showCountdown: z.boolean(),
  }),
  social: z.object({
    twitter: z.string().url().nullable(),
    linkedin: z.string().url().nullable(),
    youtube: z.string().url().nullable(),
  }),
  registration: z.object({
    open: z.boolean(),
    closedMessage: z.string(),
  }),
});

export const SpeakerSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  company: z.string(),
  bio: z.string(),
  photo: z.string(),
  social: z.object({
    linkedin: z.string().url().nullable(),
    twitter: z.string().url().nullable(),
  }),
  talkId: z.string(),
});

export const ScheduleItemSchema = z.object({
  id: z.string(),
  start: z.string(),
  end: z.string(),
  title: z.string(),
  type: z.enum(["talk", "keynote", "panel", "break", "logistics"]),
  level: z.enum(["beginner", "intermediate", "advanced"]).nullable().optional(),
  abstract: z.string().optional(),
  speakerIds: z.array(z.string()),
});

export const SponsorSchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: z.enum(["platinum", "gold", "silver", "community"]),
  logo: z.string(),
  url: z.string().url(),
  visible: z.boolean(),
});

export const OrganizerSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  bio: z.string(),
  social: z.object({
    linkedin: z.string().url().nullable(),
    twitter: z.string().url().nullable(),
  }),
});

export const FaqItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string(),
});

export type SiteConfig = z.infer<typeof SiteConfigSchema>;
export type Speaker = z.infer<typeof SpeakerSchema>;
export type ScheduleItem = z.infer<typeof ScheduleItemSchema>;
export type Sponsor = z.infer<typeof SponsorSchema>;
export type Organizer = z.infer<typeof OrganizerSchema>;
export type FaqItem = z.infer<typeof FaqItemSchema>;

// ---------------------------------------------------------------------------
// Path resolution — publish dir vs fallback
// ---------------------------------------------------------------------------

function resolveFallbackDir(): string {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, "apps/public-web/content"),
    join(cwd, "content"),
    resolve(cwd, "content"),
    join(resolve(cwd, ".."), "content"),
    // When cwd is apps/api or apps/public-web
    resolve(cwd, "../public-web/content"),
    resolve(cwd, "../../apps/public-web/content"),
    resolve(cwd, "../../content"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "site-config.json"))) return c;
  }
  try {
    const guessed = resolve(join(cwd, "apps/public-web/content"));
    if (existsSync(join(guessed, "site-config.json"))) return guessed;
  } catch {
    // ignore
  }
  return resolve(cwd, "content");
}

function resolvePublishDir(): string | null {
  const envDir = process.env.PUBLISH_DIR?.trim();
  if (envDir && envDir.length > 0) {
    const abs = resolve(envDir);
    if (existsSync(abs)) return abs;
    // Still return env path even if not exists — caller will check exists
    return abs;
  }
  // Common local locations
  const candidates = [
    join(process.cwd(), "content-published"),
    join(process.cwd(), "apps/public-web/content-published"),
    join(process.cwd(), ".content-published"),
    resolve(process.cwd(), "../content-published"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Default guess — may not exist, but return first candidate path for fallback logic
  return null;
}

function readJsonWithFallback<T>(
  filename: string,
  schema: z.ZodType<T>,
  fallbackDir: string,
  publishDir: string | null
): T {
  // Try publish dir first
  if (publishDir) {
    const publishPath = join(publishDir, filename);
    if (existsSync(publishPath)) {
      try {
        const raw = readFileSync(publishPath, "utf-8");
        const parsed = JSON.parse(raw);
        const result = schema.safeParse(parsed);
        if (result.success) return result.data;
        // If validation fails, fall back to committed file (log warning)
        console.warn(
          `[content-source] publish ${filename} validation failed, falling back:`,
          result.error.message
        );
      } catch (error) {
        console.warn(
          `[content-source] failed to read publish ${filename}:`,
          String((error as Error).message)
        );
      }
    }
  }
  // Fallback to committed
  const fallbackPath = join(fallbackDir, filename);
  if (existsSync(fallbackPath)) {
    try {
      const raw = readFileSync(fallbackPath, "utf-8");
      const parsed = JSON.parse(raw);
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      throw new Error(`Fallback ${filename} validation failed: ${result.error.message}`);
    } catch (error) {
      throw new Error(`Failed to read fallback ${filename}: ${String((error as Error).message)}`);
    }
  }
  // If fallback not found via fs, try import (for Next build where content is bundled)
  throw new Error(
    `Neither publish nor fallback found for ${filename} (publishDir=${publishDir}, fallbackDir=${fallbackDir})`
  );
}

// Cache for runtime — avoid re-reading on every request (still zero fetch to api, just fs)
let cache: Record<string, unknown> | null = null;

function getAllContent(): {
  siteConfig: SiteConfig;
  speakers: Speaker[];
  schedule: ScheduleItem[];
  sponsors: Sponsor[];
  organizers: Organizer[];
  faq: FaqItem[];
} {
  if (cache) return cache as never;
  const fallbackDir = resolveFallbackDir();
  const publishDir = resolvePublishDir();
  const siteConfig = readJsonWithFallback(
    "site-config.json",
    SiteConfigSchema,
    fallbackDir,
    publishDir
  );
  const speakers = readJsonWithFallback(
    "speakers.json",
    SpeakerSchema.array(),
    fallbackDir,
    publishDir
  );
  const schedule = readJsonWithFallback(
    "schedule.json",
    ScheduleItemSchema.array(),
    fallbackDir,
    publishDir
  );
  const sponsors = readJsonWithFallback(
    "sponsors.json",
    SponsorSchema.array(),
    fallbackDir,
    publishDir
  );
  const organizers = readJsonWithFallback(
    "organizers.json",
    OrganizerSchema.array(),
    fallbackDir,
    publishDir
  );
  const faq = readJsonWithFallback("faq.json", FaqItemSchema.array(), fallbackDir, publishDir);
  const all = { siteConfig, speakers, schedule, sponsors, organizers, faq };
  cache = all as unknown as Record<string, unknown>;
  return all;
}

// ---------------------------------------------------------------------------
// Public API — used by public-web pages (static generation)
// ---------------------------------------------------------------------------

export function getSiteConfig(): SiteConfig {
  return getAllContent().siteConfig;
}

export function getSpeakers(): Speaker[] {
  return getAllContent().speakers;
}

export function getSchedule(): ScheduleItem[] {
  return getAllContent().schedule;
}

export function getSponsors(): Sponsor[] {
  return getAllContent().sponsors;
}

export function getOrganizers(): Organizer[] {
  return getAllContent().organizers;
}

export function getFaq(): FaqItem[] {
  return getAllContent().faq;
}

// Helpers for UI

export function getSpeaker(id: string): Speaker | undefined {
  return getSpeakers().find((s) => s.id === id);
}

export function getVisibleSponsors(): Sponsor[] {
  return getSponsors().filter((s) => s.visible);
}

export const sponsorTierOrder = ["platinum", "gold", "silver", "community"] as const;
export type SponsorTier = (typeof sponsorTierOrder)[number];

export const sponsorTierLabels: Record<SponsorTier, string> = {
  platinum: "Platinum",
  gold: "Gold",
  silver: "Silver",
  community: "Community Supporter",
};

export const sessionTypeLabels: Record<ScheduleItem["type"], string> = {
  talk: "Talk",
  keynote: "Keynote",
  panel: "Panel",
  break: "Break",
  logistics: "—",
};

// ---------------------------------------------------------------------------
// Venue TBA — never fabricated (§16)
// ---------------------------------------------------------------------------

/**
 * Returns display string for venue — null when TBA (no fabrication).
 * UI should show "Venue to be announced" separately, not as venueName.
 */
export function getVenueDisplay(siteConfig: SiteConfig): {
  status: "tba" | "confirmed";
  name: string | null;
  address: string | null;
} {
  if (siteConfig.event.venueStatus === "tba") {
    return { status: "tba", name: null, address: null };
  }
  return {
    status: "confirmed",
    name: siteConfig.event.venueName ?? null,
    address: siteConfig.event.venueAddress ?? null,
  };
}

/**
 * Build JSON-LD Event object — MUST NOT include location when venue TBA / missing.
 * Verified by publish.test.ts
 */
export function buildEventJsonLd(siteConfig: SiteConfig): Record<string, unknown> {
  const base: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: siteConfig.event.name,
    startDate: siteConfig.event.date,
    location: undefined,
  };
  // Only include location when venue is confirmed and has name/address
  const venue = getVenueDisplay(siteConfig);
  if (venue.status === "confirmed" && (venue.name || venue.address)) {
    base.location = {
      "@type": "Place",
      name: venue.name ?? siteConfig.event.city,
      address: venue.address ?? siteConfig.event.city,
    };
  } else {
    // Explicitly delete location key for TBA — never fabricate "TBA" placeholder
    delete base.location;
  }
  // Clean undefined keys
  if (base.location === undefined) delete base.location;
  return base;
}

// Test helper — clear cache between tests when PUBLISH_DIR changes
export function __clearContentCache(): void {
  cache = null;
}

// For testing — expose resolvers
export const __test = {
  resolveFallbackDir,
  resolvePublishDir,
  readJsonWithFallback,
};

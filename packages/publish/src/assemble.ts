/**
 * Assemble DB → content/*.json
 * Pure assembly: reads DB, maps to JSON shapes, validates via Zod, returns files map.
 * No FS write here — caller (PublishTarget) writes.
 * Explicit publishing only; idempotent because deterministic mapping.
 * Venue TBA never fabricated (§16) — when venue fields are null/empty, keep null.
 */

import { z } from "zod";
import type { Db } from "@pgegypt/db";
import * as schema from "@pgegypt/db";

// ---------------------------------------------------------------------------
// Zod content schemas — mirror lib/content.ts + config validation
// Used to validate assembled output BEFORE writing to publish dir.
// ---------------------------------------------------------------------------

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

// Maps of files to their array schemas for validation
const SCHEMAS: Record<string, z.ZodType> = {
  "site-config.json": SiteConfigSchema,
  "speakers.json": SpeakerSchema.array(),
  "schedule.json": ScheduleItemSchema.array(),
  "sponsors.json": SponsorSchema.array(),
  "organizers.json": OrganizerSchema.array(),
  "faq.json": FaqItemSchema.array(),
};

// ---------------------------------------------------------------------------
// Helpers — Drizzle sync vs D1 async agnostic
// ---------------------------------------------------------------------------

async function selectAll(query: unknown): Promise<unknown[]> {
  const q = query as Record<string, unknown>;
  if (typeof q.all === "function") {
    const res = (q.all as () => unknown)();
    const awaited = res instanceof Promise ? await res : res;
    if (Array.isArray(awaited)) return awaited;
    if (
      awaited &&
      typeof awaited === "object" &&
      "results" in (awaited as Record<string, unknown>)
    ) {
      return ((awaited as Record<string, unknown>).results as unknown[]) ?? [];
    }
    return Array.isArray(awaited) ? awaited : [];
  }
  const res = await (query as Promise<unknown>);
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && "results" in (res as Record<string, unknown>)) {
    return ((res as Record<string, unknown>).results as unknown[]) ?? [];
  }
  return [];
}

import { eq, isNull, asc } from "drizzle-orm";

export type AssembleOptions = {
  eventId?: string;
};

// Default event id used throughout
const DEFAULT_EVENT_ID = "evt_00000000-0000-7000-8000-000000000001";

// Fallback data for non-DB content (organizers, faq) — mirrors committed files
// Inline to avoid needing extra files in package (keeps publish package self-contained)
const fallbackOrganizers: unknown[] = [
  {
    id: "ahmed-zaki",
    name: "Ahmed Zaki",
    role: "Lead Organizer",
    bio: "Backend engineer and long-time PostgreSQL contributor kicking off the Egypt community.",
    social: { linkedin: "https://linkedin.com/in/example", twitter: null },
  },
  {
    id: "heba-mansour",
    name: "Heba Mansour",
    role: "Community Chair",
    bio: "Runs the local PostgreSQL meetup and leads speaker outreach for the conference.",
    social: { linkedin: "https://linkedin.com/in/example", twitter: null },
  },
  {
    id: "tarek-ibrahim",
    name: "Tarek Ibrahim",
    role: "Sponsorship Lead",
    bio: "Handles sponsor relationships and partnerships for PG Day Egypt.",
    social: { linkedin: "https://linkedin.com/in/example", twitter: "https://x.com/example" },
  },
  {
    id: "rana-fathy",
    name: "Rana Fathy",
    role: "Volunteer Coordinator",
    bio: "Coordinates the on-the-ground volunteer team making event day run smoothly.",
    social: { linkedin: "https://linkedin.com/in/example", twitter: null },
  },
];

const fallbackFaq: unknown[] = [
  {
    id: "free",
    question: "Is the event free?",
    answer: "Yes, PG Day Egypt 2026 is free to attend. Registering secures your spot.",
  },
  {
    id: "language",
    question: "What language will talks be in?",
    answer: "All talks and materials will be in English.",
  },
  {
    id: "recording",
    question: "Will sessions be recorded?",
    answer:
      "We're aiming to record and publish talks after the event — details will be posted here once confirmed.",
  },
  {
    id: "audience",
    question: "Who should attend?",
    answer:
      "Anyone working with or curious about PostgreSQL — backend engineers, DBAs, data engineers, students, and engineering leaders.",
  },
  {
    id: "coc",
    question: "Is there a Code of Conduct?",
    answer:
      "Yes — see our [Code of Conduct](/code-of-conduct). All attendees, speakers, and sponsors are expected to follow it.",
  },
  {
    id: "speaking",
    question: "How do I become a speaker or sponsor?",
    answer:
      "The agenda for 2026 is set, but reach out via [Contact](/contact) — we'd love to hear from you for future editions.",
  },
];

// We avoid importing fallback site-config directly to prevent circular — use hardcoded defaults that match repo fallback
const FALLBACK_SITE_DEFAULTS = {
  organizer: { name: "PostgreSQL Egypt User Group", contactEmail: "hello@pgegypt.org" },
  features: { showSponsors: true, showCountdown: true },
  social: {
    twitter: "https://x.com/pgegypt",
    linkedin: "https://www.linkedin.com/company/pgegypt",
    youtube: null as string | null,
  },
  registration: {
    open: true,
    closedMessage:
      "Registration is currently closed. Check back soon or follow us on social media for updates.",
  },
} as const;

// ---------------------------------------------------------------------------
// Main assemble function — pure composition, no FS
// ---------------------------------------------------------------------------

export async function assembleContent(
  db: Db,
  options: AssembleOptions = {}
): Promise<Record<string, unknown>> {
  const eventId = options.eventId ?? DEFAULT_EVENT_ID;

  // ----- Fetch rows -----
  const eventRows = await selectAll(
    db.select().from(schema.events).where(isNull(schema.events.deletedAt))
  );
  // Prefer requested eventId, fallback to first event
  const event =
    (eventRows as Array<typeof schema.events.$inferSelect>).find((e) => e.id === eventId) ??
    (eventRows[0] as typeof schema.events.$inferSelect | undefined);

  // If no event in DB (empty), we still produce a minimal site-config with fallback values — validation will catch missing required fields but we provide defaults
  const speakerRows = (await selectAll(
    db.select().from(schema.speakers).where(isNull(schema.speakers.deletedAt))
  )) as Array<typeof schema.speakers.$inferSelect>;
  // Filter out drafts (isDraft=1) in JS to avoid SQLite boolean nuance
  const activeSpeakers = speakerRows.filter((s) => !s.isDraft && !s.deletedAt);

  const sessionRows = (await selectAll(
    db.select().from(schema.sessions).where(isNull(schema.sessions.deletedAt))
  )) as Array<typeof schema.sessions.$inferSelect>;
  const activeSessions = sessionRows.filter((s) => !s.isDraft && !s.deletedAt);

  const sponsorRows = (await selectAll(
    db.select().from(schema.sponsors).where(isNull(schema.sponsors.deletedAt))
  )) as Array<typeof schema.sponsors.$inferSelect>;

  const sessionSpeakerRows = (await selectAll(db.select().from(schema.sessionSpeakers))) as Array<
    typeof schema.sessionSpeakers.$inferSelect
  >;

  // Build maps for joins
  const speakersById = new Map(activeSpeakers.map((s) => [s.id, s]));
  // Map sessionId -> speakerIds
  const speakerIdsBySession = new Map<string, string[]>();
  for (const row of sessionSpeakerRows) {
    if (!speakersById.has(row.speakerId)) continue; // skip draft speakers
    const arr = speakerIdsBySession.get(row.sessionId) ?? [];
    arr.push(row.speakerId);
    speakerIdsBySession.set(row.sessionId, arr);
  }
  // Map speakerId -> first talkId (for speaker.talkId field)
  const talkIdBySpeaker = new Map<string, string>();
  for (const [sessionId, sIds] of speakerIdsBySession.entries()) {
    for (const sId of sIds) {
      if (!talkIdBySpeaker.has(sId)) talkIdBySpeaker.set(sId, sessionId);
    }
  }

  // ----- Build site-config.json -----
  // Venue TBA constraint: never fabricate venueName/venueAddress when missing — keep null
  const siteConfig = buildSiteConfig(event);

  // ----- Build speakers.json -----
  const speakersJson = activeSpeakers
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      id: s.slug,
      name: s.name,
      role: s.role ?? "",
      company: s.company ?? "",
      bio: s.bio,
      photo: s.photoUrl ?? s.photoKey ?? `/images/speakers/${s.slug}.svg`,
      social: {
        linkedin: s.linkedin ?? null,
        twitter: s.twitter ?? null,
      },
      talkId: talkIdBySpeaker.get(s.id) ?? activeSessions[0]?.slug ?? "opening",
    }));

  // ----- Build schedule.json -----
  const scheduleJson = activeSessions
    .slice()
    .sort((a, b) => {
      const aEpoch = a.startsAtEpoch ?? 0;
      const bEpoch = b.startsAtEpoch ?? 0;
      if (aEpoch !== bEpoch) return aEpoch - bEpoch;
      return (a.startsAt ?? "").localeCompare(b.startsAt ?? "");
    })
    .map((sess) => ({
      id: sess.slug,
      start: sess.startsAt ?? "",
      end: sess.endsAt ?? "",
      title: sess.title,
      type: (sess.type as "talk" | "keynote" | "panel" | "break" | "logistics") ?? "talk",
      level: (sess.level as "beginner" | "intermediate" | "advanced" | null) ?? null,
      abstract: sess.abstract ?? undefined,
      speakerIds: (speakerIdsBySession.get(sess.id) ?? []).map(
        (sid) => speakersById.get(sid)?.slug ?? sid
      ),
    }));

  // ----- Build sponsors.json -----
  const sponsorsJson = sponsorRows
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((sp) => ({
      id: sp.slug,
      name: sp.name,
      tier: (sp.tier as "platinum" | "gold" | "silver" | "community") ?? "community",
      logo: sp.logoUrl ?? sp.logoKey ?? `/images/sponsors/${sp.slug}.svg`,
      url: sp.url,
      visible: Boolean(sp.visible),
    }));

  // ----- Organizers & FAQ — not in DB yet, use fallback committed data -----
  // These are imported as JSON; we validate them too.
  const organizersJson = (fallbackOrganizers as unknown[]) ?? [];
  const faqJson = (fallbackFaq as unknown[]) ?? [];

  const files: Record<string, unknown> = {
    "site-config.json": siteConfig,
    "speakers.json": speakersJson,
    "schedule.json": scheduleJson,
    "sponsors.json": sponsorsJson,
    "organizers.json": organizersJson,
    "faq.json": faqJson,
  };

  // ----- Validate each file via Zod -----
  for (const [filename, data] of Object.entries(files)) {
    const zodSchema = SCHEMAS[filename];
    if (!zodSchema) continue;
    const result = zodSchema.safeParse(data);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Validation failed for ${filename}: ${issues}`);
    }
  }

  return files;
}

function buildSiteConfig(
  event: typeof schema.events.$inferSelect | undefined
): z.infer<typeof SiteConfigSchema> {
  // §16.1 step 1: settings_json (organizer/features/social/registration) overrides fallback defaults
  let settings: Record<string, unknown> = {};
  if (event?.settingsJson) {
    try {
      settings = JSON.parse(event.settingsJson as string) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }
  const organizer = {
    name:
      (settings.organizer as { name?: string } | undefined)?.name ??
      FALLBACK_SITE_DEFAULTS.organizer.name,
    contactEmail:
      (settings.organizer as { contactEmail?: string } | undefined)?.contactEmail ??
      FALLBACK_SITE_DEFAULTS.organizer.contactEmail,
  };
  const features = {
    showSponsors:
      (settings.features as { showSponsors?: boolean } | undefined)?.showSponsors ??
      FALLBACK_SITE_DEFAULTS.features.showSponsors,
    showCountdown:
      (settings.features as { showCountdown?: boolean } | undefined)?.showCountdown ??
      FALLBACK_SITE_DEFAULTS.features.showCountdown,
  };
  const social = {
    twitter: ((settings.social as { twitter?: string | null } | undefined)?.twitter ??
      FALLBACK_SITE_DEFAULTS.social.twitter) as string | null,
    linkedin: ((settings.social as { linkedin?: string | null } | undefined)?.linkedin ??
      FALLBACK_SITE_DEFAULTS.social.linkedin) as string | null,
    youtube: ((settings.social as { youtube?: string | null } | undefined)?.youtube ??
      FALLBACK_SITE_DEFAULTS.social.youtube) as string | null,
  };
  const registration = {
    open:
      (settings.registration as { open?: boolean } | undefined)?.open ??
      FALLBACK_SITE_DEFAULTS.registration.open,
    closedMessage:
      (settings.registration as { closedMessage?: string } | undefined)?.closedMessage ??
      FALLBACK_SITE_DEFAULTS.registration.closedMessage,
  };

  // If no event, return fallback-like config with TBA venue (nulls)
  if (!event) {
    return {
      event: {
        name: "PG Day Egypt 2026",
        tagline: "Egypt's first PostgreSQL community conference",
        date: "2026-10-10",
        dateDisplay: "Saturday, October 10, 2026",
        city: "Cairo, Egypt",
        venueStatus: "tba",
        venueName: null,
        venueAddress: null,
        timezone: "Africa/Cairo",
      },
      organizer,
      features,
      social,
      registration,
    };
  }

  // Venue TBA: never fabricate. If venueStatus is tba, keep venueName/Address as null even if DB has empty string
  const venueStatus = (event.venueStatus as "tba" | "confirmed") ?? "tba";
  const rawVenueName = event.venueName;
  const rawVenueAddress = event.venueAddress;
  // Only expose venueName/Address when venueStatus is confirmed AND fields are non-empty
  const venueName =
    venueStatus === "confirmed" && rawVenueName && rawVenueName.trim().length > 0
      ? rawVenueName.trim()
      : null;
  const venueAddress =
    venueStatus === "confirmed" && rawVenueAddress && rawVenueAddress.trim().length > 0
      ? rawVenueAddress.trim()
      : null;

  return {
    event: {
      name: event.name,
      tagline: event.tagline ?? "Egypt's first PostgreSQL community conference",
      date: event.date,
      dateDisplay: event.dateDisplay ?? event.date,
      city: event.city,
      venueStatus,
      venueName,
      venueAddress,
      timezone: event.timezone ?? "Africa/Cairo",
    },
    organizer,
    features,
    social,
    registration,
  };
}

/**
 * Validate assembled files without DB — pure Zod check.
 * Useful for service to double-check before write.
 */
export function validateAssembledFiles(files: Record<string, unknown>): {
  ok: boolean;
  errors?: string[];
} {
  const errors: string[] = [];
  for (const [filename, data] of Object.entries(files)) {
    const zodSchema = SCHEMAS[filename];
    if (!zodSchema) continue;
    const result = zodSchema.safeParse(data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(`${filename} ${issue.path.join(".")}: ${issue.message}`);
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

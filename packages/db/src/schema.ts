/**
 * Drizzle sqlite-core schema — PGDay 2026 §12
 * Covers all required tables with TEXT PK (UUIDv7), unixepoch INTEGER timestamps,
 * soft deletes, FKs with CASCADE/SET NULL, UNIQUE(event_id,email) on registrations,
 * indexes on status/event_id, and checks enforced via SQL migrations.
 *
 * Pure declarative schema — no side effects. Compatible with both better-sqlite3
 * (local) and D1 (prod) dialects — no Postgres syntax.
 */

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

// Helper: unixepoch default for INTEGER timestamps
const unixNow = sql`(unixepoch())`;

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline"),
  date: text("date").notNull(),
  dateDisplay: text("date_display"),
  city: text("city").notNull(),
  venueStatus: text("venue_status").notNull().default("tba"),
  venueName: text("venue_name"),
  venueAddress: text("venue_address"),
  venueLat: real("venue_lat"),
  venueLng: real("venue_lng"),
  status: text("status").notNull().default("active"),
  settingsJson: text("settings_json").notNull().default("{}"),
  timezone: text("timezone").notNull().default("Africa/Cairo"),
  createdAt: integer("created_at").notNull().default(unixNow),
  updatedAt: integer("updated_at").notNull().default(unixNow),
  deletedAt: integer("deleted_at"),
});

// ---------------------------------------------------------------------------
// users (admin users)
// ---------------------------------------------------------------------------
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("ADMIN"),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at").notNull().default(unixNow),
    updatedAt: integer("updated_at").notNull().default(unixNow),
    deletedAt: integer("deleted_at"),
    lastLoginAt: integer("last_login_at"),
  },
  (t) => ({
    emailIdx: index("idx_users_email").on(t.email),
  })
);

// ---------------------------------------------------------------------------
// admin_permissions — 2 roles (SUPER_ADMIN/ADMIN), 9 modules, WRITE→READ invariant
// ---------------------------------------------------------------------------
export const adminPermissions = sqliteTable(
  "admin_permissions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    canRead: integer("can_read").notNull().default(0),
    canWrite: integer("can_write").notNull().default(0),
    createdAt: integer("created_at").notNull().default(unixNow),
    updatedAt: integer("updated_at").notNull().default(unixNow),
  },
  (t) => ({
    uniqUserModule: unique("uq_admin_permissions_user_module").on(t.userId, t.module),
    userIdx: index("idx_admin_permissions_user_id").on(t.userId),
    moduleIdx: index("idx_admin_permissions_module").on(t.module),
  })
);

// ---------------------------------------------------------------------------
// rooms
// ---------------------------------------------------------------------------
export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull().default(unixNow),
    updatedAt: integer("updated_at").notNull().default(unixNow),
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    uniqEventSlug: unique("uq_rooms_event_slug").on(t.eventId, t.slug),
    uniqEventName: unique("uq_rooms_event_name").on(t.eventId, t.name),
    eventIdx: index("idx_rooms_event_id").on(t.eventId),
  })
);

// ---------------------------------------------------------------------------
// speakers
// ---------------------------------------------------------------------------
export const speakers = sqliteTable(
  "speakers",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    role: text("role"),
    company: text("company"),
    bio: text("bio").notNull(),
    photoUrl: text("photo_url"),
    photoKey: text("photo_key"),
    linkedin: text("linkedin"),
    twitter: text("twitter"),
    isDraft: integer("is_draft").notNull().default(0),
    createdAt: integer("created_at").notNull().default(unixNow),
    updatedAt: integer("updated_at").notNull().default(unixNow),
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    uniqEventSlug: unique("uq_speakers_event_slug").on(t.eventId, t.slug),
    eventIdx: index("idx_speakers_event_id").on(t.eventId),
    draftIdx: index("idx_speakers_is_draft").on(t.isDraft),
  })
);

// ---------------------------------------------------------------------------
// sessions (conference sessions) — includes rooms FK
// ---------------------------------------------------------------------------
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    roomId: text("room_id").references(() => rooms.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull().default("talk"),
    level: text("level"),
    abstract: text("abstract"),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    startsAtEpoch: integer("starts_at_epoch"),
    endsAtEpoch: integer("ends_at_epoch"),
    isDraft: integer("is_draft").notNull().default(0),
    status: text("status").notNull().default("draft"),
    createdAt: integer("created_at").notNull().default(unixNow),
    updatedAt: integer("updated_at").notNull().default(unixNow),
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    uniqEventSlug: unique("uq_sessions_event_slug").on(t.eventId, t.slug),
    eventIdx: index("idx_sessions_event_id").on(t.eventId),
    roomIdx: index("idx_sessions_room_id").on(t.roomId),
    typeIdx: index("idx_sessions_type").on(t.type),
    statusIdx: index("idx_sessions_status").on(t.status),
  })
);

// ---------------------------------------------------------------------------
// session_speakers — join
// ---------------------------------------------------------------------------
export const sessionSpeakers = sqliteTable(
  "session_speakers",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    speakerId: text("speaker_id")
      .notNull()
      .references(() => speakers.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(unixNow),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.speakerId] }),
    speakerIdx: index("idx_session_speakers_speaker_id").on(t.speakerId),
  })
);

// ---------------------------------------------------------------------------
// sponsors
// ---------------------------------------------------------------------------
export const sponsors = sqliteTable(
  "sponsors",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tier: text("tier").notNull(),
    logoUrl: text("logo_url"),
    logoKey: text("logo_key"),
    url: text("url").notNull(),
    visible: integer("visible").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull().default(unixNow),
    updatedAt: integer("updated_at").notNull().default(unixNow),
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    uniqEventSlug: unique("uq_sponsors_event_slug").on(t.eventId, t.slug),
    eventIdx: index("idx_sponsors_event_id").on(t.eventId),
    tierIdx: index("idx_sponsors_tier").on(t.tier),
  })
);

// ---------------------------------------------------------------------------
// cfp_submissions
// ---------------------------------------------------------------------------
export const cfpSubmissions = sqliteTable(
  "cfp_submissions",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    abstract: text("abstract").notNull(),
    track: text("track"),
    level: text("level"),
    status: text("status").notNull().default("submitted"),
    submitterName: text("submitter_name").notNull(),
    submitterEmail: text("submitter_email").notNull(),
    submitterBio: text("submitter_bio"),
    createdAt: integer("created_at").notNull().default(unixNow),
    updatedAt: integer("updated_at").notNull().default(unixNow),
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    eventIdx: index("idx_cfp_submissions_event_id").on(t.eventId),
    statusIdx: index("idx_cfp_submissions_status").on(t.status),
    emailIdx: index("idx_cfp_submissions_submitter_email").on(t.submitterEmail),
  })
);

// ---------------------------------------------------------------------------
// cfp_submission_speakers
// ---------------------------------------------------------------------------
export const cfpSubmissionSpeakers = sqliteTable(
  "cfp_submission_speakers",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => cfpSubmissions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    bio: text("bio"),
    company: text("company"),
    role: text("role"),
    isPrimary: integer("is_primary").notNull().default(0),
    createdAt: integer("created_at").notNull().default(unixNow),
  },
  (t) => ({
    submissionIdx: index("idx_cfp_submission_speakers_submission_id").on(t.submissionId),
    emailIdx: index("idx_cfp_submission_speakers_email").on(t.email),
  })
);

// ---------------------------------------------------------------------------
// cfp_reviews
// ---------------------------------------------------------------------------
export const cfpReviews = sqliteTable(
  "cfp_reviews",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => cfpSubmissions.id, { onDelete: "cascade" }),
    reviewerId: text("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    score: integer("score"),
    comment: text("comment"),
    statusFrom: text("status_from"),
    statusTo: text("status_to"),
    createdAt: integer("created_at").notNull().default(unixNow),
  },
  (t) => ({
    submissionIdx: index("idx_cfp_reviews_submission_id").on(t.submissionId),
    reviewerIdx: index("idx_cfp_reviews_reviewer_id").on(t.reviewerId),
  })
);

// ---------------------------------------------------------------------------
// registrations — UNIQUE(event_id,email), checkin_token unique
// ---------------------------------------------------------------------------
export const registrations = sqliteTable(
  "registrations",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    organization: text("organization"),
    role: text("role"),
    dietaryNotes: text("dietary_notes"),
    status: text("status").notNull().default("pending"),
    checkinToken: text("checkin_token").unique(),
    checkedInAt: integer("checked_in_at"),
    consentAt: integer("consent_at").notNull().default(0),
    createdAt: integer("created_at").notNull().default(unixNow),
    updatedAt: integer("updated_at").notNull().default(unixNow),
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    uniqEventEmail: unique("uq_registrations_event_email").on(t.eventId, t.email),
    uniqCheckinToken: unique("uq_registrations_checkin_token").on(t.checkinToken),
    statusIdx: index("idx_registrations_status").on(t.status),
    eventIdx: index("idx_registrations_event_id").on(t.eventId),
    emailIdx: index("idx_registrations_email").on(t.email),
  })
);

// ---------------------------------------------------------------------------
// media — direct-to-R2/MinIO presigned PUT
// ---------------------------------------------------------------------------
export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").references(() => events.id, { onDelete: "set null" }),
    uploaderId: text("uploader_id").references(() => users.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    originalName: text("original_name"),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    bucket: text("bucket").notNull().default("pgegypt-media"),
    kind: text("kind").notNull().default("other"),
    width: integer("width"),
    height: integer("height"),
    status: text("status").notNull().default("pending"),
    url: text("url"),
    createdAt: integer("created_at").notNull().default(unixNow),
    updatedAt: integer("updated_at").notNull().default(unixNow),
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    eventIdx: index("idx_media_event_id").on(t.eventId),
    uploaderIdx: index("idx_media_uploader_id").on(t.uploaderId),
    statusIdx: index("idx_media_status").on(t.status),
    kindIdx: index("idx_media_kind").on(t.kind),
  })
);

// ---------------------------------------------------------------------------
// audit_logs
// ---------------------------------------------------------------------------
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: text("metadata"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at").notNull().default(unixNow),
  },
  (t) => ({
    actorIdx: index("idx_audit_logs_actor_id").on(t.actorId),
    targetIdx: index("idx_audit_logs_target_type").on(t.targetType),
    createdIdx: index("idx_audit_logs_created_at").on(t.createdAt),
  })
);

// ---------------------------------------------------------------------------
// rate_limits — key PK, window_start unixepoch
// ---------------------------------------------------------------------------
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull().default(0),
  updatedAt: integer("updated_at").notNull().default(unixNow),
});

// ---------------------------------------------------------------------------
// publications — publish pipeline log
// ---------------------------------------------------------------------------
export const publications = sqliteTable(
  "publications",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"),
    contentHash: text("content_hash"),
    publishedAt: integer("published_at"),
    publishedBy: text("published_by").references(() => users.id, { onDelete: "set null" }),
    metadata: text("metadata"),
    createdAt: integer("created_at").notNull().default(unixNow),
    updatedAt: integer("updated_at").notNull().default(unixNow),
  },
  (t) => ({
    eventIdx: index("idx_publications_event_id").on(t.eventId),
    statusIdx: index("idx_publications_status").on(t.status),
  })
);

// ---------------------------------------------------------------------------
// checkins — §24.2 (UNIQUE registration_id makes double-scan idempotent at DB level)
// ---------------------------------------------------------------------------
export const checkins = sqliteTable(
  "checkins",
  {
    id: text("id").primaryKey(),
    registrationId: text("registration_id")
      .notNull()
      .unique()
      .references(() => registrations.id, { onDelete: "cascade" }),
    checkedInByUserId: text("checked_in_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    method: text("method").notNull().default("qr"),
    createdAt: integer("created_at").notNull().default(unixNow),
  },
  (t) => ({
    registrationIdx: index("idx_checkins_registration_id").on(t.registrationId),
  })
);

// ---------------------------------------------------------------------------
// user_sessions — auth sessions (opaque cookie pgegypt_session)
// Separate from conference `sessions` to avoid name collision,
// but `sessions` table is conference sessions. Auth uses `user_sessions`.
// ---------------------------------------------------------------------------
export const userSessions = sqliteTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at").notNull().default(unixNow),
  },
  (t) => ({
    userIdx: index("idx_user_sessions_user_id").on(t.userId),
    expiresIdx: index("idx_user_sessions_expires_at").on(t.expiresAt),
  })
);

// Re-export type helpers
export type Event = typeof events.$inferSelect;
export type User = typeof users.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Speaker = typeof speakers.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Sponsor = typeof sponsors.$inferSelect;
export type Registration = typeof registrations.$inferSelect;
export type Media = typeof media.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

-- Re-export: see ../../migrations/0002_full_schema.sql (canonical)
-- This copy ensures packages/db/migrations exists for drizzle-kit and tests.
-- Contents are identical to root migrations/0002_full_schema.sql

PRAGMA foreign_keys = OFF;
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT,
  date TEXT NOT NULL,
  date_display TEXT,
  city TEXT NOT NULL,
  venue_status TEXT NOT NULL DEFAULT 'tba' CHECK (venue_status IN ('tba','confirmed')),
  venue_name TEXT,
  venue_address TEXT,
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);
INSERT OR IGNORE INTO events (id, slug, name, tagline, date, date_display, city, venue_status, timezone)
VALUES ('evt_00000000-0000-7000-8000-000000000001','pgegypt-2026','PG Day Egypt 2026','Egypt''s first PostgreSQL community conference','2026-10-10','Saturday, October 10, 2026','Cairo, Egypt','tba','Africa/Cairo');
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('SUPER_ADMIN','ADMIN')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE TABLE IF NOT EXISTS admin_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('users','registrations','speakers','sessions','rooms','sponsors','cfp','media','publish','audit','events')),
  can_read INTEGER NOT NULL DEFAULT 0 CHECK (can_read IN (0,1)),
  can_write INTEGER NOT NULL DEFAULT 0 CHECK (can_write IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, module),
  CHECK (can_write = 0 OR can_read = 1)
);
CREATE INDEX IF NOT EXISTS idx_admin_permissions_user_id ON admin_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_permissions_module ON admin_permissions(module);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  UNIQUE(event_id, slug),
  UNIQUE(event_id, name)
);
CREATE INDEX IF NOT EXISTS idx_rooms_event_id ON rooms(event_id);
INSERT OR IGNORE INTO rooms (id, event_id, slug, name, capacity, sort_order)
VALUES ('room_00000000-0000-7000-8000-000000000001','evt_00000000-0000-7000-8000-000000000001','main-hall','Main Hall',300,0);
CREATE TABLE IF NOT EXISTS speakers (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  company TEXT,
  bio TEXT NOT NULL,
  photo_url TEXT,
  photo_key TEXT,
  linkedin TEXT,
  twitter TEXT,
  is_draft INTEGER NOT NULL DEFAULT 0 CHECK (is_draft IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  UNIQUE(event_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_speakers_event_id ON speakers(event_id);
CREATE INDEX IF NOT EXISTS idx_speakers_is_draft ON speakers(is_draft);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'talk' CHECK (type IN ('talk','keynote','panel','break','logistics')),
  level TEXT CHECK (level IS NULL OR level IN ('beginner','intermediate','advanced')),
  abstract TEXT,
  starts_at TEXT,
  ends_at TEXT,
  starts_at_epoch INTEGER,
  ends_at_epoch INTEGER,
  is_draft INTEGER NOT NULL DEFAULT 0 CHECK (is_draft IN (0,1)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  UNIQUE(event_id, slug),
  CHECK (starts_at_epoch IS NULL OR ends_at_epoch IS NULL OR starts_at_epoch < ends_at_epoch)
);
CREATE INDEX IF NOT EXISTS idx_sessions_event_id ON sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_sessions_room_id ON sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(type);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE TABLE IF NOT EXISTS session_speakers (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  speaker_id TEXT NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (session_id, speaker_id)
);
CREATE INDEX IF NOT EXISTS idx_session_speakers_speaker_id ON session_speakers(speaker_id);
CREATE TABLE IF NOT EXISTS sponsors (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('platinum','gold','silver','community')),
  logo_url TEXT,
  logo_key TEXT,
  url TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  UNIQUE(event_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_sponsors_event_id ON sponsors(event_id);
CREATE INDEX IF NOT EXISTS idx_sponsors_tier ON sponsors(tier);
CREATE TABLE IF NOT EXISTS cfp_submissions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  abstract TEXT NOT NULL,
  track TEXT,
  level TEXT CHECK (level IS NULL OR level IN ('beginner','intermediate','advanced')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','accepted','rejected')),
  submitter_name TEXT NOT NULL,
  submitter_email TEXT NOT NULL,
  submitter_bio TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cfp_submissions_event_id ON cfp_submissions(event_id);
CREATE INDEX IF NOT EXISTS idx_cfp_submissions_status ON cfp_submissions(status);
CREATE INDEX IF NOT EXISTS idx_cfp_submissions_submitter_email ON cfp_submissions(submitter_email);
CREATE TABLE IF NOT EXISTS cfp_submission_speakers (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES cfp_submissions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  bio TEXT,
  company TEXT,
  role TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_cfp_submission_speakers_submission_id ON cfp_submission_speakers(submission_id);
CREATE INDEX IF NOT EXISTS idx_cfp_submission_speakers_email ON cfp_submission_speakers(email);
CREATE TABLE IF NOT EXISTS cfp_reviews (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES cfp_submissions(id) ON DELETE CASCADE,
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  score INTEGER CHECK (score IS NULL OR (score >= 1 AND score <= 5)),
  comment TEXT,
  status_from TEXT,
  status_to TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_cfp_reviews_submission_id ON cfp_reviews(submission_id);
CREATE INDEX IF NOT EXISTS idx_cfp_reviews_reviewer_id ON cfp_reviews(reviewer_id);
CREATE TABLE IF NOT EXISTS registrations_new (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 2),
  email TEXT NOT NULL,
  organization TEXT,
  role TEXT,
  dietary_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','waitlisted','declined')),
  checkin_token TEXT UNIQUE,
  checked_in_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  UNIQUE(event_id, email)
);
CREATE INDEX IF NOT EXISTS idx_registrations_status_new ON registrations_new(status);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id_new ON registrations_new(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_email_new ON registrations_new(email);
INSERT OR IGNORE INTO registrations_new (id, event_id, name, email, organization, role, dietary_notes, status, created_at, updated_at)
SELECT id,'evt_00000000-0000-7000-8000-000000000001',name,lower(email),organization,role,dietary_notes,status,
  CASE WHEN typeof(created_at)='integer' THEN created_at WHEN created_at GLOB '*[^0-9]*' THEN unixepoch(created_at) ELSE CAST(created_at AS INTEGER) END,
  unixepoch() FROM registrations WHERE NOT EXISTS (SELECT 1 FROM pragma_table_info('registrations') WHERE name='event_id');
CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) >= 2),
  email TEXT NOT NULL,
  organization TEXT,
  role TEXT,
  dietary_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','waitlisted','declined')),
  checkin_token TEXT UNIQUE,
  checked_in_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  UNIQUE(event_id, email)
);
INSERT OR IGNORE INTO registrations (id, event_id, name, email, organization, role, dietary_notes, status, checkin_token, checked_in_at, created_at, updated_at, deleted_at)
SELECT id, event_id, name, email, organization, role, dietary_notes, status, checkin_token, checked_in_at, created_at, updated_at, deleted_at FROM registrations_new;
DROP TABLE IF EXISTS registrations_new;
CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_event_email ON registrations(event_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_registrations_checkin_token ON registrations(checkin_token);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email);
CREATE TABLE IF NOT EXISTS rate_limits_new (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO rate_limits_new (key, window_start, count, updated_at)
SELECT key,CASE WHEN typeof(window_start)='integer' THEN window_start WHEN window_start GLOB '*[^0-9]*' THEN unixepoch(window_start) ELSE CAST(window_start AS INTEGER) END,count,unixepoch() FROM rate_limits WHERE NOT EXISTS (SELECT 1 FROM pragma_table_info('rate_limits') WHERE name='updated_at');
CREATE TABLE IF NOT EXISTS rate_limits_canonical_check (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO rate_limits_canonical_check SELECT * FROM rate_limits_new;
DROP TABLE IF EXISTS rate_limits_new;
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  storage_key TEXT NOT NULL UNIQUE,
  bucket TEXT NOT NULL DEFAULT 'pgegypt-media',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','deleted')),
  url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_media_event_id ON media(event_id);
CREATE INDEX IF NOT EXISTS idx_media_uploader_id ON media(uploader_id);
CREATE INDEX IF NOT EXISTS idx_media_status ON media(status);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_type ON audit_logs(target_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','failed')),
  content_hash TEXT,
  published_at INTEGER,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_publications_event_id ON publications(event_id);
CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(status);
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
PRAGMA foreign_keys = ON;

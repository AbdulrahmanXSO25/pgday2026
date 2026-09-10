-- Migration 0003: spec §12 parity columns (additive)
-- Adds columns required by specs.md §12.1/§12.2/§12.12 that 0002 omitted:
--   events.settings_json, events.status, events.venue_lat, events.venue_lng
--   users.status (active/disabled revoke, §14.3)
--   registrations.consent_at (§12.12)
-- All ALTERs are idempotent-guarded by the migrate.ts runner (per-statement, duplicate-column errors swallowed).

ALTER TABLE events ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE events ADD COLUMN venue_lat REAL;
ALTER TABLE events ADD COLUMN venue_lng REAL;

ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE registrations ADD COLUMN consent_at INTEGER NOT NULL DEFAULT 0;

-- §11.4: "exactly one active event" is enforced by APPLICATION logic (multi-event inserts
-- with default 'active' must remain possible for tests/seeds) — no partial unique index.
CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role) WHERE deleted_at IS NULL;

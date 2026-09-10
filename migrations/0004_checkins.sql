-- Migration 0004: checkins table (§24.2)
-- Spec requires a checkins record with UNIQUE(registration_id) so a double-scan is
-- idempotent at the DB level, plus who checked them in and the method used.
-- registrations.checked_in_at remains as a fast-path flag.

CREATE TABLE IF NOT EXISTS checkins (
  id                     TEXT PRIMARY KEY,
  registration_id        TEXT NOT NULL UNIQUE REFERENCES registrations(id) ON DELETE CASCADE,
  checked_in_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  method                 TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','manual')),
  created_at             INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_checkins_registration_id ON checkins(registration_id);

-- Migration: initial schema
-- Migration number: 0001

CREATE TABLE registrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  organization TEXT,
  role TEXT,
  dietary_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | waitlisted | declined
  created_at TEXT NOT NULL
);

CREATE INDEX idx_registrations_status ON registrations(status);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

-- Migration: event conference hours (start/end time)
-- Migration number: 0009

ALTER TABLE events ADD COLUMN start_time TEXT;
ALTER TABLE events ADD COLUMN end_time TEXT;
-- Migration 0007: drop leftover temporary tables from the 0002 upgrade path.
-- 0002 used *_new/_canonical_check scratch tables; these are safe to remove everywhere
-- (idempotent, append-only migration).

DROP TABLE IF EXISTS rate_limits_canonical_check;
DROP TABLE IF EXISTS rate_limits_new;
DROP TABLE IF EXISTS rate_limits_new2;
DROP TABLE IF EXISTS registrations_new;
DROP TABLE IF EXISTS registrations_new_full;
DROP TABLE IF EXISTS registrations_new_race;
DROP TABLE IF EXISTS registrations_new_test;

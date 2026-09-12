-- Migration: add portrait photo to CFP submission speakers
-- Migration number: 0008

ALTER TABLE cfp_submission_speakers ADD COLUMN photo_url TEXT;
ALTER TABLE cfp_submission_speakers ADD COLUMN photo_key TEXT;
-- Migration 0005: media kind/width/height (§12.13, §17.3/§17.4)
-- kind enables per-kind MIME/size rules; width/height are populated at confirm time
-- from a lightweight header probe so the public site can set explicit <Image> dimensions.

ALTER TABLE media ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';
ALTER TABLE media ADD COLUMN width INTEGER;
ALTER TABLE media ADD COLUMN height INTEGER;

CREATE INDEX IF NOT EXISTS idx_media_kind ON media(kind);

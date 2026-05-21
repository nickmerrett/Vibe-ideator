-- Migration 016: Add weekly review fields to ideas table

ALTER TABLE ideas ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMP;
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_ideas_snoozed_until ON ideas(snoozed_until);
CREATE INDEX IF NOT EXISTS idx_ideas_last_reviewed_at ON ideas(last_reviewed_at);

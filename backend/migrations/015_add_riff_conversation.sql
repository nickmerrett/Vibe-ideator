-- Migration 015: Store riff chat history on the idea

ALTER TABLE ideas ADD COLUMN riff_conversation TEXT;

-- Migration 018: Store beads epic ID on projects for export
ALTER TABLE projects ADD COLUMN beads_epic_id TEXT;

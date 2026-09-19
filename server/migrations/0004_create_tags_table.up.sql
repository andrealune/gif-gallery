-- Migration: 0004_create_tags_table
-- Purpose: lookup table for the many-to-many tags a GIF can have
--   (e.g. "cat", "monday", "excited"). The join table is created in
--   0006_create_gif_tags_table.
--
-- Locking behaviour: same as 0003 -- brand-new table, no contention.
-- Rollback: drops the table (see down script). Safe before gif_tags exists;
--   once populated, the down-migration of 0006 must run first.
-- Data impact: none, creates an empty table.

CREATE TABLE tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(50) NOT NULL,
  slug       VARCHAR(60) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tags_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT tags_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE UNIQUE INDEX tags_name_unique_idx ON tags (lower(name));
CREATE UNIQUE INDEX tags_slug_unique_idx ON tags (slug);

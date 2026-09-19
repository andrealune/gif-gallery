-- Migration: 0006_create_gif_tags_table
-- Purpose: many-to-many join between gifs and tags.
--
-- Locking behaviour: brand-new table with two FKs; no contention since
--   gifs/tags are empty at this point in a fresh database. On a database
--   where gifs/tags already have rows (re-running this migration set on an
--   existing cluster), adding the FKs only takes a lock on gif_tags itself,
--   not on gifs/tags, because there is nothing yet in gif_tags to validate.
-- Rollback: drops the table. Safe at any time -- nothing references
--   gif_tags itself.
-- Data impact: none, creates an empty table.

CREATE TABLE gif_tags (
  gif_id     UUID NOT NULL REFERENCES gifs(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (gif_id, tag_id)
);

-- PK already covers lookups by gif_id (its leading column); a dedicated
-- index is needed for the reverse direction ("which gifs have tag X").
CREATE INDEX gif_tags_tag_id_idx ON gif_tags (tag_id);

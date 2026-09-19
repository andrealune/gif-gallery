-- Migration: 0003_create_categories_table
-- Purpose: lookup table for the single category a GIF belongs to
--   (e.g. "Reactions", "Animals", "Sports").
--
-- Locking behaviour: CREATE TABLE on a brand-new table takes an
--   ACCESS EXCLUSIVE lock that nobody else can be holding yet, since the
--   table does not exist -- no contention with running queries.
-- Rollback: 0003_create_categories_table.down.sql drops the table. Safe as
--   long as no gifs row references it yet (true right after this migration
--   set is first applied; if run later in a populated database, drop the
--   gifs.category_id column/FK first -- see the down script for the guard).
-- Data impact: none, this only creates an empty table.

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(120) NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT categories_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- Case-insensitive uniqueness: "Animals" and "animals" are the same category.
CREATE UNIQUE INDEX categories_name_unique_idx ON categories (lower(name));
CREATE UNIQUE INDEX categories_slug_unique_idx ON categories (slug);

CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Migration: 0012_add_thumbnail_url_to_categories
-- Purpose: backs the CategorySummary.thumbnailUrl field (L42-449 / L42-462) so a category can
--   carry a representative thumbnail image, with the frontend (L42-450, <CategoryCard>) falling
--   back to an emoji placeholder while the column is null/unpopulated.
--
-- Note: L42-449 ("backend: add thumbnailUrl to CategorySummary") was previously marked "done" in
--   the tracker, but no migration, repository or type change actually existed in this repo at that
--   time (see L42-462). This migration is the first real implementation of that work.
--
-- Locking behaviour: ADD COLUMN with no default and no NOT NULL constraint is a fast,
--   metadata-only change on Postgres 11+ (no table rewrite, brief ACCESS EXCLUSIVE lock only long
--   enough to update the catalog) - safe to run against a populated `categories` table.
-- Rollback: 0012_add_thumbnail_url_to_categories.down.sql drops the column. Any thumbnail_url
--   values written after this migration runs are lost on rollback.
-- Data impact: every existing row gets thumbnail_url = NULL; no backfill needed since the
--   frontend already treats null/absent as "show emoji fallback".

ALTER TABLE categories
  ADD COLUMN thumbnail_url TEXT;

-- Migration: 0002_updated_at_trigger_function
-- Purpose: a single reusable trigger function that keeps an `updated_at`
--   column current on every UPDATE. Attached to individual tables by later
--   migrations (categories, tags, gifs).
--
-- Locking behaviour: creates a function only; no table lock.
-- Rollback: drops the function. Must run after the down-migrations of any
--   table that still has a trigger referencing it (enforced by running
--   `migrate down` in reverse migration order).
-- Data impact: none.

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

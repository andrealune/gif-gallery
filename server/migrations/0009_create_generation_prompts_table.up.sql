-- Migration: 0009_create_generation_prompts_table
-- Purpose: category -> prompt mapping that drives the AI batch generation
--   scheduler (L42-424): which text prompt(s) are eligible to be sent to the
--   image-generation API for a given category. Implements the data model
--   and business rules (BR-1..BR-7) from
--   docs/specs/ai-generation-prompts-spec.md (L42-423).
--
-- Design notes:
--   * `category_id` is `ON DELETE RESTRICT` -- deliberately different from
--     `gifs.category_id` (`ON DELETE SET NULL`). A gif can lose its category
--     and still stand alone as content; a prompt with no category is
--     meaningless (nothing would ever select it), so deleting a category
--     that still has prompt rows is refused. Retirement procedure: (1) set
--     `is_active = false` on every prompt for that category, (2) confirm the
--     scheduler has stopped selecting it (no new `generation_attempts`
--     referencing it), (3) delete the now-inactive prompt rows, then the
--     category itself.
--   * `is_active` (soft-disable, not a hard delete) so a prompt can be
--     paused/retired without losing the `generation_attempts` audit trail
--     that references it (BR-3).
--   * Unique expression index on `(category_id, lower(btrim(prompt_text)))`
--     prevents an intra-category duplicate prompt (BR-5) while still
--     allowing identical wording to be reused across *different*
--     categories.
--   * `prompt_text` is capped at 1000 characters -- the DALL-E 3 prompt
--     limit (BR-4/FR-3).
--
-- Locking behaviour: brand-new table with one FK to categories; no
--   contention on a fresh database.
-- Rollback: 0009_create_generation_prompts_table.down.sql drops the table.
--   Safe once generation_attempts (0010), which references this table, has
--   already been rolled back -- enforced by running `migrate down` in
--   reverse order.
-- Data impact: none, creates an empty table.

CREATE TABLE generation_prompts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  category_id   UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  prompt_text   TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT generation_prompts_text_not_blank CHECK (btrim(prompt_text) <> ''),
  CONSTRAINT generation_prompts_text_length CHECK (char_length(prompt_text) <= 1000)
);

CREATE INDEX generation_prompts_category_id_idx ON generation_prompts (category_id);

-- Only active prompts are ever selected by the scheduler (BR-1/BR-2); this
-- partial index keeps that hot-path lookup cheap regardless of how many
-- retired prompts accumulate over time.
CREATE INDEX generation_prompts_active_category_idx
  ON generation_prompts (category_id)
  WHERE is_active;

CREATE UNIQUE INDEX generation_prompts_category_text_unique_idx
  ON generation_prompts (category_id, lower(btrim(prompt_text)));

CREATE TRIGGER generation_prompts_set_updated_at
  BEFORE UPDATE ON generation_prompts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

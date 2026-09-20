-- Migration: 0009_create_generation_prompts_table
-- Purpose: category -> AI-image-generation-prompt mapping (L42-423 spec,
--   FR-1..FR-5). Each row is one candidate prompt for a category; the batch
--   scheduler (L42-424) reads the active ones for a category and picks among
--   them (BR-1, BR-2). This is seed/config data maintained by
--   engineering/content owners, not end users (no end-user authoring is in
--   scope).
--
-- Locking behaviour: CREATE TABLE on a brand-new table takes an ACCESS
--   EXCLUSIVE lock that nobody else can be holding yet, since the table does
--   not exist -- no contention with running queries. The FK to `categories`
--   takes a brief ROW SHARE lock on `categories` to validate it, not a
--   table-rewrite lock.
-- Rollback: 0009_create_generation_prompts_table.down.sql drops the table.
--   Safe at any time, including with populated `generation_attempts` rows --
--   that table's FK to this one is `ON DELETE SET NULL` (0010), so it never
--   blocks dropping this table; still rolled back after 0010 by the runner's
--   reverse-migration-order convention (DROP TABLE requires no live FK
--   pointing at it, regardless of that FK's ON DELETE action).
-- Data impact: none, this only creates an empty table.
--
-- Category lifecycle policy (deliberately different from
-- `gifs.category_id`'s `ON DELETE SET NULL`): a prompt with no category is
-- meaningless (there is nothing for the scheduler to select it *for*), so
-- `category_id` is NOT NULL and its FK is `ON DELETE RESTRICT`. Deleting a
-- category that still has prompt rows is refused rather than silently
-- orphaning/nulling them. Retiring a category that has prompts is a
-- deliberate procedure (see server/docs/database-schema.md for the full
-- writeup):
--   1. Deactivate its prompts: `UPDATE generation_prompts SET is_active =
--      false WHERE category_id = :id;` -- stops the scheduler from
--      selecting them immediately (BR-3), while preserving history/audit.
--      This alone satisfies most "retire this category from AI generation"
--      needs without deleting anything.
--   2. Once ready to actually purge, in FK order: `DELETE FROM
--      generation_prompts WHERE category_id = :id;` then `DELETE FROM
--      categories WHERE id = :id;`. This is a reviewed, destructive action --
--      not something a migration or the application does automatically.
--      Unlike an earlier draft of this migration set, this step is not
--      blocked by attempt history: `generation_attempts.generation_prompt_id`
--      is `ON DELETE SET NULL` (0010), not `RESTRICT` -- BR-7 attributability
--      for existing attempts survives that regardless, because
--      `generation_attempts` also snapshots `category_id`/`prompt_text`
--      directly at write time (see 0010's header for why). Deleting still-
--      referenced attempt rows themselves, if ever required (e.g. a
--      retention purge), remains a separate, deliberate decision.
-- Renaming a category (`UPDATE categories SET name = ... WHERE id = :id`) is
-- unaffected either way: the FK is on `id`, not `name`/`slug`, so a rename
-- never touches `generation_prompts` rows.

CREATE TABLE generation_prompts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  prompt_text  TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- FR-3 / BR-4: 1-1000 characters (DALL-E 3 prompt limit). Rejected at
  -- creation time, not discovered later at API-call time.
  CONSTRAINT generation_prompts_text_not_blank CHECK (btrim(prompt_text) <> ''),
  CONSTRAINT generation_prompts_text_max_length CHECK (char_length(prompt_text) <= 1000)
);

CREATE INDEX generation_prompts_category_id_idx ON generation_prompts (category_id);

-- The scheduler's actual query is "active prompts for category X"
-- (BR-1/BR-2/BR-3) -- a partial index on the active subset keeps that
-- lookup cheap without indexing soft-disabled rows nobody selects.
CREATE INDEX generation_prompts_active_category_idx
  ON generation_prompts (category_id)
  WHERE is_active;

-- BR-5 (referential integrity) is enforced by the FK above; this unique
-- expression index adds the complementary rule that the same prompt text
-- cannot be registered twice for the same category (case- and
-- surrounding-whitespace-insensitive, matching the `categories` table's own
-- `lower(name)` convention), so seed re-runs and future admin tooling can't
-- silently accumulate duplicate rows.
CREATE UNIQUE INDEX generation_prompts_category_text_unique_idx
  ON generation_prompts (category_id, lower(btrim(prompt_text)));

CREATE TRIGGER generation_prompts_set_updated_at
  BEFORE UPDATE ON generation_prompts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

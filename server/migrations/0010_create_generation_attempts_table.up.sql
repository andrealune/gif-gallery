-- Migration: 0010_create_generation_attempts_table
-- Purpose: audit trail of every batch-generation attempt (L42-424): which
--   prompt was used, whether it succeeded, the gif it produced (if any),
--   and enough detail to debug/report on failures without re-running
--   anything. Directly implements BR-7 from
--   docs/specs/ai-generation-prompts-spec.md ("a failure must be
--   attributable to a specific generation_prompt row... and must not
--   silently retry with a different, unrelated prompt").
--
-- Design notes:
--   * `generation_prompt_id`/`category_id` are both `ON DELETE SET NULL`:
--     unlike `generation_prompts.category_id` (RESTRICT), an attempts row is
--     a historical record, not a live reference -- it must survive its
--     prompt or category later being removed, just with the pointer
--     cleared. `prompt_text` is additionally captured verbatim on the row
--     itself so the audit trail is still meaningful after that happens.
--   * `gif_id` is `ON DELETE SET NULL` for the same reason: deleting a gif
--     later (moderation, cleanup) must not delete the attempt that produced
--     it.
--   * `cost_usd NUMERIC(10,4)` mirrors the cost-tracking precision already
--     used in `src/services/ai/costTracker.ts`. No partition/retention plan
--     yet -- tens of rows/day expected; revisit if volume grows materially.
--   * Two CHECK constraints keep `status` internally consistent instead of
--     relying on application code: a `failed` attempt must record an error,
--     a `succeeded` one must not, and a `succeeded` attempt must point at
--     the gif it produced.
--
-- Locking behaviour: brand-new table with three nullable FKs; no
--   contention on a fresh database.
-- Rollback: 0010_create_generation_attempts_table.down.sql drops the table
--   and its status enum. Safe at any time -- nothing references this table.
-- Data impact: none, creates an empty table.

CREATE TYPE generation_attempt_status AS ENUM ('succeeded', 'failed');

CREATE TABLE generation_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  generation_prompt_id  UUID REFERENCES generation_prompts(id) ON DELETE SET NULL,
  category_id           UUID REFERENCES categories(id) ON DELETE SET NULL,
  gif_id                UUID REFERENCES gifs(id) ON DELETE SET NULL,

  status                generation_attempt_status NOT NULL,
  prompt_text           TEXT NOT NULL,
  model                 VARCHAR(100),
  cost_usd              NUMERIC(10, 4) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  error_code            VARCHAR(100),
  error_message         TEXT,

  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT generation_attempts_prompt_text_not_blank CHECK (btrim(prompt_text) <> ''),
  CONSTRAINT generation_attempts_failed_has_error CHECK (
    (status = 'failed' AND error_message IS NOT NULL) OR
    (status = 'succeeded' AND error_message IS NULL)
  ),
  CONSTRAINT generation_attempts_succeeded_has_gif CHECK (
    (status = 'succeeded' AND gif_id IS NOT NULL) OR
    (status = 'failed')
  )
);

CREATE INDEX generation_attempts_prompt_id_idx ON generation_attempts (generation_prompt_id);
CREATE INDEX generation_attempts_category_id_idx ON generation_attempts (category_id);
CREATE INDEX generation_attempts_status_idx ON generation_attempts (status);
CREATE INDEX generation_attempts_created_at_idx ON generation_attempts (created_at DESC);

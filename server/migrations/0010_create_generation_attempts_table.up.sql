-- Migration: 0010_create_generation_attempts_table
-- Purpose: one row per batch-scheduler (L42-424) call to the image-generation
--   API for a given `generation_prompts` row (BR-7: every success/failure
--   must be attributable to a specific prompt, and must not be silently
--   retried against a different, unrelated prompt).
--
--   Per ADR-0002 (image-to-GIF conversion pipeline, gap G7): the
--   image-generation API ("DALL-E") returns a static image, not a GIF, so an
--   attempt has two distinct artifacts to track: the source image the API
--   returned, and -- once/if the conversion pipeline succeeds -- the derived
--   GIF stored in the existing `gifs` table. Carrying both on one row (rather
--   than only the final GIF) means a conversion failure after a successful
--   image generation is still visible and attributable, instead of looking
--   identical to a prompt that the image-generation API itself rejected.
--
-- Locking behaviour: CREATE TABLE on a brand-new table takes an ACCESS
--   EXCLUSIVE lock that nobody else can be holding yet -- no contention with
--   running queries. The three FKs (to `generation_prompts`, `categories` and
--   `gifs`) take a brief ROW SHARE lock on those tables to validate, not a
--   rewrite lock.
-- Rollback: 0010_create_generation_attempts_table.down.sql drops the table.
--   Safe at any time -- nothing else references `generation_attempts`.
-- Data impact: none, this only creates an empty table.
--
-- Column set matches `src/services/generation/attemptsRepository.ts`
-- (`GenerationAttemptsRepository.record`, L42-424) exactly -- that repository
-- and its call site (`scheduler.ts`) were already implemented and merged
-- against this table by the time this migration landed, so the schema is
-- fit to that real, tested write path rather than designed in isolation:
--
-- Why `generation_prompt_id` is nullable, `ON DELETE SET NULL` (not
-- `NOT NULL`/`RESTRICT` as an earlier draft of this migration had it):
-- `RecordFailedAttempt` (`src/services/generation/types.ts`) documents
-- `promptId` as "may be absent if the failure happened before a prompt could
-- be picked", and `attemptsRepository.ts` inserts NULL in exactly that case
-- (`attempt.promptId ?? null`) -- the schema must accept that, not just the
-- TS type declare it optional. `SET NULL` (rather than `RESTRICT`) also
-- means a `generation_prompts` row can be hard-deleted (end of the category
-- retirement procedure in `0009`) without first needing to deal with its
-- attempt history: BR-7 attributability is not lost when that happens,
-- because `category_id` and `prompt_text` below are snapshotted onto the
-- attempt row itself at write time, independent of whether the live
-- `generation_prompts`/`categories` rows they were copied from still exist.
--
-- Why `category_id` (nullable, `ON DELETE SET NULL`, mirroring
-- `gifs.category_id`'s own convention) and `prompt_text` (`NOT NULL`) exist
-- here even though they are already reachable by joining through
-- `generation_prompt_id`: `attemptsRepository.ts` writes both directly on
-- every call (succeeded or failed), and a failed attempt can have a NULL
-- `generation_prompt_id` (above) with no join path at all -- these columns
-- are the denormalized, point-in-time audit record that keeps failure
-- attribution (BR-7) intact regardless of what happens to the live
-- `generation_prompts`/`categories` rows afterwards.
--
-- Why `gif_id` is nullable and `ON DELETE SET NULL`: a `pending` attempt, or
-- one whose image generation or GIF conversion failed, has no `gifs` row yet
-- (or ever) -- see the status/gif_id consistency check below. And like the
-- prompt FK, losing the *specific* gif this attempt produced (e.g. after the
-- existing `gifs` hard-delete purge policy in server/docs/database-schema.md
-- runs) should not delete or block-delete the attempt/cost/audit record --
-- the attempt row (what was requested, what it cost, whether it succeeded)
-- remains meaningful evidence on its own.
--
-- `cost_usd NUMERIC(10,4)`: DALL-E-class per-image pricing is quoted in
-- fractions of a US dollar (e.g. $0.0400-$0.1200 per image as of writing);
-- 4 decimal places avoids rounding those to $0.00, and NUMERIC (not
-- FLOAT/DOUBLE) avoids binary floating-point drift on a column that will be
-- summed for cost reporting. NUMERIC(10,4) caps a single row at
-- 999999.9999, comfortably above any plausible per-call cost.
--
-- `source_image_url`/`source_image_metadata` are not yet written by
-- `attemptsRepository.ts` (it records the final gif via `gifRepository.ts`
-- and the outcome via `record()`, but not a standalone pre-conversion image
-- reference) -- they are kept here, nullable/defaulted so today's inserts
-- are unaffected, as the place ADR-0002's "track the source image
-- separately from the derived gif" intent lands once that write path is
-- added; see the note left on L42-445/L42-443 for whoever picks that up.
--
-- No retention/partition plan yet: at the batch scheduler's stated volume
-- (tens of attempts/day), this table reaches ~3.6k-36k rows/year, which does
-- not warrant partitioning. Revisit (time-range partitioning, or a purge
-- policy mirroring `gifs`' soft-delete-then-90-day-hard-delete policy) if
-- scheduling frequency or category/prompt count increases by an order of
-- magnitude, or if `raw_response`/`source_image_url` payloads make this
-- table's storage footprint significant.

CREATE TYPE generation_attempt_status AS ENUM ('pending', 'succeeded', 'failed');

CREATE TABLE generation_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_prompt_id  UUID REFERENCES generation_prompts(id) ON DELETE SET NULL,
  category_id           UUID REFERENCES categories(id) ON DELETE SET NULL,
  gif_id                UUID REFERENCES gifs(id) ON DELETE SET NULL,

  status                generation_attempt_status NOT NULL DEFAULT 'pending',
  provider              third_party_provider NOT NULL DEFAULT 'openai',
  model                 VARCHAR(100),
  prompt_text           TEXT NOT NULL,

  source_image_url      TEXT,
  source_image_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  error_code            VARCHAR(100),
  error_message         TEXT,
  cost_usd              NUMERIC(10,4),

  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT generation_attempts_prompt_text_not_blank
    CHECK (btrim(prompt_text) <> ''),
  CONSTRAINT generation_attempts_source_image_metadata_is_object
    CHECK (jsonb_typeof(source_image_metadata) = 'object'),
  CONSTRAINT generation_attempts_cost_non_negative
    CHECK (cost_usd IS NULL OR cost_usd >= 0),
  CONSTRAINT generation_attempts_completed_after_requested
    CHECK (completed_at IS NULL OR completed_at >= requested_at),
  -- BR-7 in data form: a `succeeded` attempt has produced a gif, and only a
  -- `succeeded` attempt may reference one -- a `pending`/`failed` attempt
  -- pointing at a `gifs` row would misattribute that gif's origin.
  CONSTRAINT generation_attempts_succeeded_iff_has_gif
    CHECK ((status = 'succeeded') = (gif_id IS NOT NULL))
);

CREATE INDEX generation_attempts_generation_prompt_id_idx ON generation_attempts (generation_prompt_id);
CREATE INDEX generation_attempts_category_id_idx ON generation_attempts (category_id);
CREATE INDEX generation_attempts_status_idx ON generation_attempts (status);
CREATE INDEX generation_attempts_requested_at_idx ON generation_attempts (requested_at);

-- A gif is produced by exactly one attempt; partial (NULLs -- pending/failed
-- attempts -- are exempt) so this doubles as the "find the attempt that
-- produced this gif" lookup.
CREATE UNIQUE INDEX generation_attempts_gif_id_unique_idx
  ON generation_attempts (gif_id)
  WHERE gif_id IS NOT NULL;

CREATE TRIGGER generation_attempts_set_updated_at
  BEFORE UPDATE ON generation_attempts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

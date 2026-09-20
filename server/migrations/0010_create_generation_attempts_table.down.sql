-- Rollback for 0010_create_generation_attempts_table
-- Locking behaviour: DROP TABLE takes ACCESS EXCLUSIVE on this table; brief
--   unless a long-running transaction is reading it.
-- Rollback order: no longer constrained by 0009 -- `generation_prompt_id` is
--   `ON DELETE SET NULL`, not `RESTRICT`, so this table's presence never
--   blocks rolling back `generation_prompts` first. Still rolled back before
--   0009 by the runner's reverse-migration-order convention.
-- Data impact: DESTRUCTIVE -- deletes every generation_attempts row (all
--   attempt/cost/error history). The `gifs`, `generation_prompts` and
--   `categories` rows themselves are untouched. Only run this on a database
--   where that is intended (e.g. tearing a dev/test DB back down); never
--   run against production without a reviewed data-loss plan.
DROP TABLE IF EXISTS generation_attempts;
DROP TYPE IF EXISTS generation_attempt_status;

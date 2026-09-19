-- Migration: 0009_create_generation_prompts_table (down)
-- Reverses 0009_create_generation_prompts_table.up.sql.
--
-- Rollback: drops the table (indexes/trigger/constraints go with it). Safe
--   once generation_attempts (0010) has already been rolled back, since it
--   holds an FK to this table -- enforced by running `migrate down` in
--   reverse order.
-- Data impact: destroys all generation_prompts rows.

DROP TABLE IF EXISTS generation_prompts;

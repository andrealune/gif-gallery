-- Migration: 0010_create_generation_attempts_table (down)
-- Reverses 0010_create_generation_attempts_table.up.sql.
--
-- Rollback: drops the table and the generation_attempt_status enum. Safe at
--   any time -- nothing else references this table or type.
-- Data impact: destroys all generation_attempts rows (the AI-generation
--   audit trail).

DROP TABLE IF EXISTS generation_attempts;
DROP TYPE IF EXISTS generation_attempt_status;

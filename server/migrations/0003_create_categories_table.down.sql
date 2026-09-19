-- Rollback for 0003_create_categories_table
-- Locking behaviour: DROP TABLE takes ACCESS EXCLUSIVE on this table; brief
--   unless a long-running transaction is reading it.
-- Data impact: DESTRUCTIVE -- deletes every category row. Only run this on
--   a database where that is intended (e.g. tearing a dev/test DB back
--   down); never run against production without a reviewed data-loss plan.
DROP TABLE IF EXISTS categories;

-- Rollback for 0004_create_tags_table
-- Data impact: DESTRUCTIVE -- deletes every tag row. Same caveats as 0003.
DROP TABLE IF EXISTS tags;

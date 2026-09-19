-- Rollback for 0006_create_gif_tags_table
-- Data impact: DESTRUCTIVE -- deletes every gif/tag association (the gifs
--   and tags themselves are untouched).
DROP TABLE IF EXISTS gif_tags;

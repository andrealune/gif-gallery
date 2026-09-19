-- Rollback for 0005_create_gifs_table
-- Locking behaviour: DROP TABLE/TYPE take ACCESS EXCLUSIVE locks, brief.
-- Data impact: DESTRUCTIVE -- deletes every gif row and both enum types.
--   Requires gif_tags and third_party_references to already be dropped
--   (their FKs reference gifs.id) -- enforced by reverse migration order.
DROP TABLE IF EXISTS gifs;
DROP TYPE IF EXISTS gif_status;
DROP TYPE IF EXISTS gif_source;

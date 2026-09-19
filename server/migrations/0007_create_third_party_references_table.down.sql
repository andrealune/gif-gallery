-- Rollback for 0007_create_third_party_references_table
-- Data impact: DESTRUCTIVE -- deletes every third-party reference row
--   (attribution/provenance/raw payload history). The gifs themselves are
--   untouched.
DROP TABLE IF EXISTS third_party_references;
DROP TYPE IF EXISTS third_party_provider;

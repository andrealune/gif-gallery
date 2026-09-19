-- Migration: 0008_seed_default_categories
-- Purpose: seed a starter set of categories so the gallery/admin UI has
--   something to show and assign before any curation happens. Product/
--   content owners can rename, add or remove categories afterwards through
--   the API -- this is a starting point, not a fixed list.
--
-- Locking behaviour: a handful of single-row INSERTs guarded by
--   ON CONFLICT DO NOTHING; briefly locks only the rows it inserts.
-- Rollback: deletes rows matching this exact seed list by slug. If an
--   operator has since renamed one of these categories, its slug may no
--   longer match and it will be left in place rather than guessed at --
--   see the down script.
-- Data impact: inserts up to 8 rows into `categories`. No existing data is
--   modified. Idempotent: safe to re-run.

INSERT INTO categories (name, slug, description) VALUES
  ('Reactions',    'reactions',    'Facial expressions and reactions for replies and comments'),
  ('Memes',        'memes',        'Popular meme gifs'),
  ('Animals',      'animals',      'Cats, dogs and other animal gifs'),
  ('Sports',       'sports',       'Sports highlights and celebrations'),
  ('Movies & TV',  'movies-tv',    'Clips from movies and television'),
  ('Anime',        'anime',        'Anime and manga gifs'),
  ('Gaming',       'gaming',       'Video game clips and highlights'),
  ('Other',        'other',        'Everything that does not fit another category')
ON CONFLICT (slug) DO NOTHING;

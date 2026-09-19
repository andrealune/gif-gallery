-- Rollback for 0008_seed_default_categories
-- Data impact: deletes only the exact seed rows below, matched by slug, and
--   only if no gif references them (ON DELETE SET NULL on gifs.category_id
--   means this would otherwise silently un-categorize gifs -- the NOT
--   EXISTS guard avoids that surprise; remove it deliberately if that's
--   really what you want).
DELETE FROM categories c
WHERE c.slug IN (
  'reactions', 'memes', 'animals', 'sports', 'movies-tv', 'anime', 'gaming', 'other'
)
AND NOT EXISTS (
  SELECT 1 FROM gifs g WHERE g.category_id = c.id
);

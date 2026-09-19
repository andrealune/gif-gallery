-- Migration: 0011_seed_generation_prompts
-- Purpose: seed one active prompt per category that both (a) is proposed in
--   docs/specs/ai-generation-prompts.seed.json (L42-423) and (b) actually
--   exists in the 0008 default-category taxonomy. Six of the ten proposed
--   categories (celebration, love, nature, technology, dance, food) have no
--   matching row in `categories` yet -- BR-6 forbids inventing a prompt for
--   a category slug that does not exist, so those are intentionally left
--   out. Gap G1 (approved category list) is still open with product-lead;
--   add prompts for the remaining categories once/if they are confirmed and
--   seeded.
--
-- Locking behaviour: a handful of single-row INSERTs guarded by
--   ON CONFLICT DO NOTHING; briefly locks only the rows it inserts.
-- Rollback: deletes rows matching this exact seed list by
--   (category slug, prompt text). If a prompt's text has since been edited,
--   it will no longer match and is left in place rather than guessed at --
--   see the down script.
-- Data impact: inserts up to 4 rows into `generation_prompts`. No existing
--   data is modified. Idempotent: safe to re-run.

INSERT INTO generation_prompts (category_id, prompt_text)
SELECT c.id, v.prompt_text
FROM (VALUES
  ('animals',   'Cute animated animal doing something funny, colorful, looping GIF style, family-friendly'),
  ('reactions', 'Exaggerated, comedic human facial expression reacting in surprise or joy, looping GIF style'),
  ('sports',    'Dynamic, energetic moment from a fun sports scene, cartoon style, looping GIF style'),
  ('memes',     'Absurd, comedic pop-culture-style scene, exaggerated expressions, looping GIF style')
) AS v(category_slug, prompt_text)
JOIN categories c ON c.slug = v.category_slug
ON CONFLICT (category_id, lower(btrim(prompt_text))) DO NOTHING;

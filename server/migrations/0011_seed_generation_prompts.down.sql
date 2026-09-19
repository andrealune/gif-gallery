-- Migration: 0011_seed_generation_prompts (down)
-- Reverses 0011_seed_generation_prompts.up.sql: deletes rows matching this
-- exact seed list by (category slug, prompt text). Left in place (not
-- deleted) if the text has since been edited by an operator.
-- Data impact: deletes at most the 4 rows this seed inserted.

DELETE FROM generation_prompts gp
USING categories c
WHERE gp.category_id = c.id
  AND (c.slug, gp.prompt_text) IN (
    ('animals',   'Cute animated animal doing something funny, colorful, looping GIF style, family-friendly'),
    ('reactions', 'Exaggerated, comedic human facial expression reacting in surprise or joy, looping GIF style'),
    ('sports',    'Dynamic, energetic moment from a fun sports scene, cartoon style, looping GIF style'),
    ('memes',     'Absurd, comedic pop-culture-style scene, exaggerated expressions, looping GIF style')
  );

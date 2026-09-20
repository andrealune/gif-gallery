/**
 * Idempotent demo seed (L42-460).
 *
 * A freshly migrated database has categories (0008_seed_default_categories) and generation
 * prompts (0011_seed_generation_prompts) but zero `gifs` rows - nothing inserts any. That leaves
 * every preview and fresh local checkout showing a homepage of categories that all report 0 gifs
 * and empty grids on every category page, so gallery/card/pagination/share/embed/gif-detail
 * behaviour can't be reviewed without first generating GIFs (needs an OpenAI key and the
 * scheduler enabled) or importing from Tenor.
 *
 * This script inserts a few dozen placeholder gif rows - spread across the categories 0008
 * seeds, tagged - pointing at small checked-in sample GIFs (`src/db/seedAssets/demo`) written
 * through the same `gifStorage` adapter (`src/services/storage`) the generation scheduler uses,
 * so they are served back exactly the way a real generated/uploaded gif would be
 * (`STORAGE_PROVIDER=local`'s `/storage` static route, or S3 + CDN when that's configured).
 *
 * NOT a migration - deliberately kept out of `migrations/`:
 *   - a migration is expected to be safe to run against a real, already-populated production
 *     database; inserting placeholder GIFs there is not what "safe" means for this repo (see the
 *     locking/rollback/data-impact header convention every file in `migrations/` follows).
 *   - `migrate.ts` runs every `.up.sql` unconditionally on `npm run migrate:up`; this needs to
 *     stay something a real deploy never runs by itself.
 *
 * Safety:
 *   - refuses to run when `NODE_ENV=production`, unless `SEED_DEMO_FORCE=true` is set explicitly.
 *     The only place that sets it is `.berry/preview.json`'s `server` app `migrate` step, for the
 *     one command below - a preview builds/starts with `NODE_ENV=production` (it's a production
 *     *build*, not a real deployment) but is never a real production database. A real deploy's
 *     migrate step never sets this flag, so this never runs there.
 *   - idempotent: every seeded gif/tag/gif_tags row is keyed by a fixed, deterministic id (see
 *     `demoGifId`) and inserted with `ON CONFLICT ... DO NOTHING`, so running this any number of
 *     times - fresh database, or re-run against one that already has the seed - converges on the
 *     same set of rows without duplicating or erroring.
 *
 * Usage (from server/):
 *   npm run seed:demo
 *   SEED_DEMO_FORCE=true npm run seed:demo   # only if NODE_ENV=production and you are certain
 *                                             # this is not a real production database
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import type { Pool, QueryResultRow } from 'pg';
import { env } from '../config/env';
import { gifStorage, type GifStorage } from '../services/storage';
import { slugifyTag } from '../services/tenor/repository';
import { closePool, pool } from './pool';

export const SEED_DEMO_FORCE_ENV_VAR = 'SEED_DEMO_FORCE';

const ASSETS_DIR = path.resolve(__dirname, 'seedAssets/demo');
// Every demo asset is generated at this fixed size/duration (see the task's PR description for
// the ffmpeg invocation used) - hardcoded rather than probed so this script has no dependency on
// ffprobe/an image library.
const ASSET_WIDTH = 240;
const ASSET_HEIGHT = 160;
const ASSET_DURATION_MS = 2000;

interface DemoGif {
  /** Stable logical key, independent of array order - see `demoGifId`. */
  key: string;
  categorySlug: string;
  title: string;
  description: string;
  tags: string[];
  /** Filename under `seedAssets/demo/`. */
  asset: string;
}

function d(key: string, categorySlug: string, title: string, description: string, tags: string[]): DemoGif {
  return { key, categorySlug, title, description, tags, asset: `${key}.gif` };
}

// 4 gifs x the 8 categories `0008_seed_default_categories.up.sql` seeds - "a couple of dozen"
// per L42-460, spread across every seeded category with a couple of tags each so tag filtering/
// pagination/card rendering all have something real to show.
export const DEMO_GIFS: DemoGif[] = [
  // Reactions
  d('reactions-1', 'reactions', 'Excited Clap', 'An excited round of applause.', ['reaction', 'excited', 'applause']),
  d('reactions-2', 'reactions', 'Thumbs Up', 'A solid thumbs up of approval.', ['reaction', 'approve', 'thumbs-up']),
  d('reactions-3', 'reactions', 'Eye Roll', 'A dramatic, sarcastic eye roll.', ['reaction', 'sarcastic', 'eye-roll']),
  d('reactions-4', 'reactions', 'Mind Blown', 'A total mind-blown moment.', ['reaction', 'shocked', 'mind-blown']),

  // Memes
  d('memes-1', 'memes', 'Success Kid', 'Small victory, huge celebration.', ['meme', 'success', 'funny']),
  d('memes-2', 'memes', 'Side-Eye', 'A suspicious side-eye glance.', ['meme', 'suspicious', 'funny']),
  d('memes-3', 'memes', 'Big Brain', 'A galaxy-brain sized idea.', ['meme', 'smart', 'funny']),
  d('memes-4', 'memes', 'Deal With It', 'Sunglasses on, problem solved.', ['meme', 'cool', 'sunglasses']),

  // Animals
  d('animals-1', 'animals', 'Sleepy Cat', 'A cat that has had enough of today.', ['animals', 'cat', 'sleepy']),
  d('animals-2', 'animals', 'Happy Dog', 'A very good, very happy dog.', ['animals', 'dog', 'happy']),
  d('animals-3', 'animals', 'Curious Fox', 'A fox investigating something offscreen.', ['animals', 'fox', 'curious']),
  d('animals-4', 'animals', 'Dancing Parrot', 'A parrot with impeccable rhythm.', ['animals', 'bird', 'dancing']),

  // Sports
  d('sports-1', 'sports', 'Buzzer Beater', 'A last-second shot right at the buzzer.', ['sports', 'basketball', 'clutch']),
  d('sports-2', 'sports', 'Touchdown', 'A game-winning touchdown celebration.', ['sports', 'football', 'celebration']),
  d('sports-3', 'sports', 'Match Point', 'The point that closes out the match.', ['sports', 'tennis', 'win']),
  d('sports-4', 'sports', 'Photo Finish', 'Too close to call without a replay.', ['sports', 'racing', 'close-call']),

  // Movies & TV
  d('movies-tv-1', 'movies-tv', 'Plot Twist', 'Nobody saw that coming.', ['movies-tv', 'drama', 'twist']),
  d('movies-tv-2', 'movies-tv', 'Season Finale', 'The finale everyone is talking about.', ['movies-tv', 'tv', 'finale']),
  d('movies-tv-3', 'movies-tv', 'Dramatic Reveal', 'The big reveal, dramatically lit.', ['movies-tv', 'drama', 'reveal']),
  d('movies-tv-4', 'movies-tv', 'Cliffhanger', 'Ending right on a cliffhanger.', ['movies-tv', 'suspense', 'cliffhanger']),

  // Anime
  d('anime-1', 'anime', 'Power Up', 'Charging up for the next move.', ['anime', 'action', 'power-up']),
  d('anime-2', 'anime', 'Transformation', 'Mid-transformation, glowing brightly.', ['anime', 'action', 'transformation']),
  d('anime-3', 'anime', 'Determined Stare', 'A stare that means business.', ['anime', 'dramatic', 'stare']),
  d('anime-4', 'anime', 'Victory Pose', 'Striking the classic victory pose.', ['anime', 'victory', 'hero']),

  // Gaming
  d('gaming-1', 'gaming', 'Level Up', 'That satisfying level-up chime moment.', ['gaming', 'level-up', 'achievement']),
  d('gaming-2', 'gaming', 'Boss Defeated', 'The boss fight, finally won.', ['gaming', 'boss', 'victory']),
  d('gaming-3', 'gaming', 'Speedrun', 'A frame-perfect speedrun trick.', ['gaming', 'speedrun', 'fast']),
  d('gaming-4', 'gaming', 'Clutch Play', 'A last-second clutch play.', ['gaming', 'clutch', 'esports']),

  // Other
  d('other-1', 'other', 'Random Fun', 'Just a bit of random fun.', ['other', 'random', 'fun']),
  d('other-2', 'other', 'Just Because', 'No reason, just because.', ['other', 'random', 'silly']),
  d('other-3', 'other', 'Everyday Moment', 'An ordinary moment, looped forever.', ['other', 'everyday', 'relatable']),
  d('other-4', 'other', 'Misc Magic', 'A little bit of miscellaneous magic.', ['other', 'misc', 'magic']),
];

/**
 * Deterministic, stable-across-runs UUID for a demo gif's logical `key` (not its position in
 * `DEMO_GIFS`, which can be reordered/extended freely without changing anyone's id).
 * Namespaced under a recognizable `de110000-...` prefix so seeded rows are easy to spot/clean up
 * (`DELETE FROM gifs WHERE id::text LIKE 'de110000-%'`) without touching real data.
 */
export function demoGifId(key: string): string {
  const hash = createHash('sha1').update(`gif-gallery-demo-seed:${key}`).digest('hex');
  return `de110000-0000-4000-8000-${hash.slice(0, 12)}`;
}

export function isForced(value = process.env[SEED_DEMO_FORCE_ENV_VAR]): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').toLowerCase());
}

/** True when this run should refuse to seed (real production, no explicit override). */
export function shouldRefuse(isProduction: boolean, forced: boolean): boolean {
  return isProduction && !forced;
}

// Same shape every other repository in this codebase depends on (see
// `services/categories/repository.ts`, `services/gifs/repository.ts`) - a plain `query()`, no
// transaction needed since every statement below is independently idempotent.
type DatabasePool = Pick<Pool, 'query'>;

async function upsertTag(database: DatabasePool, name: string): Promise<string> {
  const slug = slugifyTag(name);
  const result = await database.query<{ id: string } & QueryResultRow>(
    `INSERT INTO tags (name, slug)
     VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET slug = tags.slug
     RETURNING id`,
    [name.slice(0, 50), slug]
  );
  return result.rows[0].id;
}

async function seedGif(
  database: DatabasePool,
  storage: GifStorage,
  gif: DemoGif,
  categoryId: string,
  existingIds: Set<string>
): Promise<'inserted' | 'skipped'> {
  const id = demoGifId(gif.key);
  if (existingIds.has(id)) {
    return 'skipped';
  }

  const buffer = readFileSync(path.join(ASSETS_DIR, gif.asset));
  // Give each seeded gif its own storage key (`demo-<key>.gif`) so a re-run overwrites its own
  // file in place rather than colliding with another demo gif's key.
  const stored = await storage.save(buffer, `demo-${gif.key}.gif`, 'image/gif');

  await database.query(
    `INSERT INTO gifs
       (id, source, title, description, category_id, url, thumbnail_url, storage_path,
        width, height, file_size_bytes, duration_ms, mime_type, metadata, status)
     VALUES ($1, 'other', $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, 'image/gif', $11::jsonb, 'active')
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      gif.title,
      gif.description,
      categoryId,
      stored.url,
      stored.storagePath,
      ASSET_WIDTH,
      ASSET_HEIGHT,
      stored.sizeBytes,
      ASSET_DURATION_MS,
      JSON.stringify({ demoSeed: true, key: gif.key }),
    ]
  );

  const tagIds = await Promise.all(gif.tags.map((tag) => upsertTag(database, tag)));
  if (tagIds.length > 0) {
    await database.query(
      `INSERT INTO gif_tags (gif_id, tag_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT (gif_id, tag_id) DO NOTHING`,
      [id, tagIds]
    );
  }

  return 'inserted';
}

export interface SeedDemoResult {
  inserted: number;
  skipped: number;
  missingCategorySlugs: string[];
}

export async function seedDemo(
  database: DatabasePool = pool,
  storage: GifStorage = gifStorage
): Promise<SeedDemoResult> {
  const categorySlugs = [...new Set(DEMO_GIFS.map((g) => g.categorySlug))];
  const categoryResult = await database.query<{ id: string; slug: string } & QueryResultRow>(
    `SELECT id, slug FROM categories WHERE slug = ANY($1)`,
    [categorySlugs]
  );
  const categoryIdBySlug = new Map(categoryResult.rows.map((r) => [r.slug, r.id]));
  const missingCategorySlugs = categorySlugs.filter((slug) => !categoryIdBySlug.has(slug));

  const allIds = DEMO_GIFS.map((g) => demoGifId(g.key));
  const existingResult = await database.query<{ id: string } & QueryResultRow>(
    `SELECT id FROM gifs WHERE id = ANY($1::uuid[])`,
    [allIds]
  );
  const existingIds = new Set(existingResult.rows.map((r) => r.id));

  let inserted = 0;
  let skipped = 0;
  for (const gif of DEMO_GIFS) {
    const categoryId = categoryIdBySlug.get(gif.categorySlug);
    if (!categoryId) {
      // Category from 0008_seed_default_categories is missing (rolled back, or renamed) -
      // nothing sane to attach this gif to; skip rather than inserting with a null category.
      skipped += 1;
      continue;
    }
    const outcome = await seedGif(database, storage, gif, categoryId, existingIds);
    if (outcome === 'inserted') inserted += 1;
    else skipped += 1;
  }

  return { inserted, skipped, missingCategorySlugs };
}

async function main(): Promise<void> {
  const forced = isForced();
  if (shouldRefuse(env.isProduction, forced)) {
    // eslint-disable-next-line no-console
    console.error(
      `Refusing to run: NODE_ENV=production and ${SEED_DEMO_FORCE_ENV_VAR} is not set. This ` +
        `script inserts placeholder demo gif rows and is meant for local development and preview ` +
        `environments only, never a real production database. Set ${SEED_DEMO_FORCE_ENV_VAR}=true ` +
        `only if you are certain this is not one (e.g. a preview that builds/starts with ` +
        `NODE_ENV=production but is not a real deployment).`
    );
    process.exitCode = 1;
    return;
  }

  const result = await seedDemo();
  if (result.missingCategorySlugs.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `Skipped ${result.missingCategorySlugs.length} categor${
        result.missingCategorySlugs.length === 1 ? 'y' : 'ies'
      } not found (run migrate:up first?): ${result.missingCategorySlugs.join(', ')}`
    );
  }
  // eslint-disable-next-line no-console
  console.log(`Demo seed done: ${result.inserted} inserted, ${result.skipped} already present/skipped.`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Demo seed failed:', err);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}

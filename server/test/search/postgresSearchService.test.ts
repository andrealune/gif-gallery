/**
 * Integration tests for `PostgresGifSearchQueryService` (L42-463) against an embedded, in-memory
 * Postgres (PGlite), same technique as `test/migrations.test.ts` - every migration's `up.sql` is applied
 * first, then real rows are seeded and searched through the class exactly as `routes/search.ts` would
 * use it (`database` is PGlite's own `.query`, which matches the `Pick<Pool, 'query'>` shape this class
 * depends on).
 *
 * This is the "Postgres backend" counterpart to `test/search/searchService.test.ts` (the Elasticsearch
 * backend's unit tests, against fakes) - see the issue's "Add route tests for both backends".
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresGifSearchQueryService } from '../../src/search/postgresSearchService';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

function loadMigrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.replace(/\.up\.sql$/, ''))
    .sort((a, b) => a.localeCompare(b));
}

function readSql(name: string, direction: 'up' | 'down'): string {
  return readFileSync(path.join(MIGRATIONS_DIR, `${name}.${direction}.sql`), 'utf8');
}

async function migrateUp(db: PGlite): Promise<void> {
  for (const name of loadMigrationNames()) {
    await db.exec(readSql(name, 'up'));
  }
}

interface SeedGifOptions {
  title: string;
  description?: string | null;
  categorySlug?: string | null;
  status?: 'active' | 'archived' | 'flagged' | 'deleted';
  tags?: string[];
}

describe('PostgresGifSearchQueryService', () => {
  let db: PGlite;
  let service: PostgresGifSearchQueryService;
  let animalsCategoryId: string;
  let sportsCategoryId: string;

  async function seedGif(options: SeedGifOptions): Promise<string> {
    const categoryId =
      options.categorySlug === undefined
        ? null
        : options.categorySlug === null
          ? null
          : (
              await db.query<{ id: string }>(`SELECT id FROM categories WHERE slug = $1`, [options.categorySlug])
            ).rows[0].id;

    const status = options.status ?? 'active';
    const deletedAt = status === 'deleted' ? new Date().toISOString() : null;

    const result = await db.query<{ id: string }>(
      `INSERT INTO gifs (source, title, description, category_id, url, status, deleted_at)
       VALUES ('upload', $1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [options.title, options.description ?? null, categoryId, `https://example.com/${encodeURIComponent(options.title)}.gif`, status, deletedAt]
    );
    const gifId = result.rows[0].id;

    for (const tagName of options.tags ?? []) {
      const slug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const existing = await db.query<{ id: string }>(`SELECT id FROM tags WHERE slug = $1`, [slug]);
      const tagId =
        existing.rows[0]?.id ??
        (await db.query<{ id: string }>(`INSERT INTO tags (name, slug) VALUES ($1, $2) RETURNING id`, [tagName, slug])).rows[0].id;
      await db.query(`INSERT INTO gif_tags (gif_id, tag_id) VALUES ($1, $2)`, [gifId, tagId]);
    }

    return gifId;
  }

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(db);
    service = new PostgresGifSearchQueryService(db as never);

    // 'animals'/'sports' already exist from 0008_seed_default_categories - reuse them rather than
    // re-inserting and colliding with the case-insensitive unique name index.
    animalsCategoryId = (await db.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'animals'`)).rows[0].id;
    sportsCategoryId = (await db.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'sports'`)).rows[0].id;

    await seedGif({ title: 'Dancing cat', description: 'A cat dancing to music', categorySlug: 'animals', tags: ['cat', 'dance'] });
    await seedGif({ title: 'Sleepy dog', description: 'A dog taking a nap', categorySlug: 'animals', tags: ['dog'] });
    await seedGif({ title: 'Winning goal', description: 'A footballer celebrating a cat-like leap', categorySlug: 'sports' });
    await seedGif({ title: 'Basketball dunk', description: null, categorySlug: 'sports', tags: ['cat-themed-celebration'] });
    await seedGif({ title: 'Archived cat', description: 'Should never appear', categorySlug: 'animals', status: 'archived' });
    await seedGif({ title: 'Deleted cat', description: 'Should never appear', categorySlug: 'animals', status: 'deleted' });
  });

  afterAll(async () => {
    await db.close();
  });

  it('ranks a title match above a description-only match for the same term', async () => {
    const result = await service.search({ q: 'cat', limit: 24, offset: 0 });

    const titles = result.items.map((item) => item.title);
    expect(titles).toContain('Dancing cat');
    // "Dancing cat" matches in the title (weight A); "Winning goal" only matches in the
    // description (weight B) - the title match must rank first.
    expect(titles.indexOf('Dancing cat')).toBeLessThan(titles.indexOf('Winning goal'));
  });

  it('excludes archived and deleted gifs', async () => {
    const result = await service.search({ q: 'cat', limit: 24, offset: 0 });

    const titles = result.items.map((item) => item.title);
    expect(titles).not.toContain('Archived cat');
    expect(titles).not.toContain('Deleted cat');
  });

  it('matches a partial/in-progress word (typeahead prefix matching)', async () => {
    const result = await service.search({ q: 'danc', limit: 24, offset: 0 });

    expect(result.items.map((item) => item.title)).toContain('Dancing cat');
  });

  it('matches a gif via its tags even when the term is absent from title/description', async () => {
    const result = await service.search({ q: 'cat-themed', limit: 24, offset: 0 });

    expect(result.items.map((item) => item.title)).toContain('Basketball dunk');
  });

  it('filters by category id', async () => {
    const result = await service.search({ q: 'cat', category: sportsCategoryId, limit: 24, offset: 0 });

    // Both are in 'sports': "Winning goal" via its description, "Basketball dunk" via its
    // "cat-themed-celebration" tag (the text search parser splits hyphenated compounds into their
    // parts too, so "cat:*" matches the "cat" part of it) - and no 'animals' gif leaks in.
    expect(result.items.map((item) => item.title).sort()).toEqual(['Basketball dunk', 'Winning goal']);
  });

  it('filters by category slug', async () => {
    const result = await service.search({ q: 'cat', category: 'animals', limit: 24, offset: 0 });

    const titles = result.items.map((item) => item.title);
    expect(titles).toContain('Dancing cat');
    expect(titles).not.toContain('Winning goal');
  });

  it('returns an empty page (not an error) for a query with no matches', async () => {
    const result = await service.search({ q: 'nonexistentxyz', limit: 24, offset: 0 });

    expect(result).toEqual({ items: [], total: 0, limit: 24, offset: 0 });
  });

  it('returns an empty page for a query with no searchable tokens (e.g. only punctuation)', async () => {
    const result = await service.search({ q: '???', limit: 24, offset: 0 });

    expect(result).toEqual({ items: [], total: 0, limit: 24, offset: 0 });
  });

  it('paginates with limit/offset and reports the true total', async () => {
    const page1 = await service.search({ q: 'cat', limit: 1, offset: 0 });
    const page2 = await service.search({ q: 'cat', limit: 1, offset: 1 });

    expect(page1.items).toHaveLength(1);
    expect(page2.items).toHaveLength(1);
    expect(page1.items[0].id).not.toBe(page2.items[0].id);
    expect(page1.total).toBe(page2.total);
    expect(page1.total).toBeGreaterThanOrEqual(3); // Dancing cat, Winning goal, Basketball dunk (tag)
  });

  it('returns GifSummary-shaped rows with every field the frontend contract expects', async () => {
    const result = await service.search({ q: 'dancing', limit: 24, offset: 0 });

    expect(result.items[0]).toMatchObject({
      id: expect.any(String),
      source: 'upload',
      title: 'Dancing cat',
      categoryId: animalsCategoryId,
      status: 'active',
    });
    expect(typeof result.items[0].createdAt).toBe('string');
    expect(typeof result.items[0].updatedAt).toBe('string');
  });
});

/**
 * Integration tests for `CategoryRepository` (L42-465) against an embedded, in-memory Postgres
 * (PGlite), same technique as `test/search/postgresSearchService.test.ts` and
 * `test/migrations.test.ts` - every migration's `up.sql` is applied first, then real rows are
 * seeded and read back through the class exactly as `routes/categories.ts` would use it.
 *
 * This exists specifically to prove the fix for L42-465: `categories.thumbnail_url` (migration
 * 0012) is never written by any code path, so `CategoryRepository`'s unit tests against a fake
 * pool (`test/categories/repository.test.ts`) can't catch a query that still returns `NULL` in
 * production even though its SQL string "looks right". Only a query that actually runs against a
 * real Postgres-dialect engine can confirm the `DISTINCT ON` derivation over `gifs` works and
 * that a category with at least one active gif gets a non-null `thumbnailUrl` back.
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CategoryRepository } from '../../src/services/categories';

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
  categorySlug: string;
  status?: 'active' | 'archived' | 'flagged' | 'deleted';
  thumbnailUrl?: string | null;
  url?: string;
  createdAt?: string;
}

describe('CategoryRepository (integration, real Postgres dialect via PGlite)', () => {
  let db: PGlite;
  let repo: CategoryRepository;

  async function seedGif(options: SeedGifOptions): Promise<string> {
    const category = await db.query<{ id: string }>(`SELECT id FROM categories WHERE slug = $1`, [options.categorySlug]);
    const categoryId = category.rows[0].id;
    const status = options.status ?? 'active';
    const deletedAt = status === 'deleted' ? new Date().toISOString() : null;
    const url = options.url ?? `https://example.com/${encodeURIComponent(options.title)}.gif`;
    const thumbnailUrl = options.thumbnailUrl ?? null;
    const createdAt = options.createdAt ?? new Date().toISOString();

    const result = await db.query<{ id: string }>(
      `INSERT INTO gifs (source, title, category_id, url, thumbnail_url, status, deleted_at, created_at)
       VALUES ('upload', $1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [options.title, categoryId, url, thumbnailUrl, status, deletedAt, createdAt]
    );
    return result.rows[0].id;
  }

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(db);
    repo = new CategoryRepository(db as never);

    // 'animals'/'sports'/'other' already exist from 0008_seed_default_categories - reuse them
    // rather than re-inserting and colliding with the case-insensitive unique name index.
    await seedGif({
      title: 'Older cat gif',
      categorySlug: 'animals',
      thumbnailUrl: 'https://example.com/older-cat-thumb.gif',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    await seedGif({
      title: 'Newest cat gif',
      categorySlug: 'animals',
      thumbnailUrl: 'https://example.com/newest-cat-thumb.gif',
      createdAt: '2024-02-01T00:00:00.000Z',
    });
    // No thumbnail_url of its own on the gif - the category thumbnail should fall back to the
    // gif's `url`.
    await seedGif({
      title: 'Winning goal',
      categorySlug: 'sports',
      url: 'https://example.com/winning-goal.gif',
      thumbnailUrl: null,
      createdAt: '2024-01-15T00:00:00.000Z',
    });
    // Only an archived gif - must not count as "active" for the derived thumbnail.
    await seedGif({
      title: 'Archived-only category gif',
      categorySlug: 'other',
      status: 'archived',
      thumbnailUrl: 'https://example.com/should-not-appear.gif',
      createdAt: '2024-03-01T00:00:00.000Z',
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns a non-null thumbnailUrl for a category with at least one active gif, taken from the most recently created one', async () => {
    const category = await repo.findCategory('animals');

    expect(category?.thumbnailUrl).toBe('https://example.com/newest-cat-thumb.gif');
  });

  it('falls back to the gif url when the most recent active gif has no thumbnail_url of its own', async () => {
    const category = await repo.findCategory('sports');

    expect(category?.thumbnailUrl).toBe('https://example.com/winning-goal.gif');
  });

  it('leaves thumbnailUrl null for a category with only non-active gifs', async () => {
    const category = await repo.findCategory('other');

    expect(category?.thumbnailUrl).toBeNull();
  });

  it('populates thumbnailUrl the same way through listCategories', async () => {
    const page = await repo.listCategories({ limit: 50, offset: 0 });
    const animals = page.items.find((c) => c.slug === 'animals');
    const other = page.items.find((c) => c.slug === 'other');

    expect(animals?.thumbnailUrl).toBe('https://example.com/newest-cat-thumb.gif');
    expect(other?.thumbnailUrl).toBeNull();
  });
});

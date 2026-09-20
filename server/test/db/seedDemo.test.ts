import { existsSync } from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEMO_GIFS,
  SEED_DEMO_FORCE_ENV_VAR,
  demoGifId,
  isForced,
  seedDemo,
  shouldRefuse,
} from '../../src/db/seedDemo';

const ASSETS_DIR = path.resolve(__dirname, '../../src/db/seedAssets/demo');

interface FakeRow {
  [key: string]: unknown;
}

/** Minimal fake of the `Pick<Pool, 'query'>` surface `seedDemo` depends on, backed by in-memory
 * tables so the idempotency/insert logic can be exercised without a real Postgres. */
function fakeDatabase(options: { categories?: { id: string; slug: string }[] } = {}) {
  const categories = options.categories ?? [
    { id: 'cat-reactions', slug: 'reactions' },
    { id: 'cat-memes', slug: 'memes' },
    { id: 'cat-animals', slug: 'animals' },
    { id: 'cat-sports', slug: 'sports' },
    { id: 'cat-movies-tv', slug: 'movies-tv' },
    { id: 'cat-anime', slug: 'anime' },
    { id: 'cat-gaming', slug: 'gaming' },
    { id: 'cat-other', slug: 'other' },
  ];
  const tagsBySlug = new Map<string, { id: string; name: string; slug: string }>();
  const gifsById = new Map<string, FakeRow>();
  const gifTags = new Set<string>();
  let tagSeq = 0;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const normalized = sql.trim();

    if (normalized.startsWith('SELECT id, slug FROM categories')) {
      const slugs = params[0] as string[];
      return { rows: categories.filter((c) => slugs.includes(c.slug)) };
    }

    if (normalized.startsWith('SELECT id FROM gifs WHERE id = ANY')) {
      const ids = params[0] as string[];
      return { rows: ids.filter((id) => gifsById.has(id)).map((id) => ({ id })) };
    }

    if (normalized.startsWith('INSERT INTO tags')) {
      const [name, slug] = params as [string, string];
      const existing = tagsBySlug.get(slug);
      if (existing) return { rows: [{ id: existing.id }] };
      const id = `tag-${++tagSeq}`;
      tagsBySlug.set(slug, { id, name, slug });
      return { rows: [{ id }] };
    }

    if (normalized.startsWith('INSERT INTO gifs')) {
      const [id] = params as [string, ...unknown[]];
      if (!gifsById.has(id)) {
        gifsById.set(id, { id, params });
      }
      return { rows: [] };
    }

    if (normalized.startsWith('INSERT INTO gif_tags')) {
      const [gifId, tagIds] = params as [string, string[]];
      for (const tagId of tagIds) gifTags.add(`${gifId}:${tagId}`);
      return { rows: [] };
    }

    throw new Error(`fakeDatabase: unhandled query: ${normalized}`);
  });

  return { query, gifsById, gifTags, tagsBySlug };
}

function fakeStorage() {
  const saved: { filename: string; mimeType?: string }[] = [];
  return {
    save: vi.fn(async (buffer: Buffer, filename: string, mimeType?: string) => {
      saved.push({ filename, mimeType });
      return { url: `https://cdn.example.com/${filename}`, storagePath: filename, sizeBytes: buffer.length };
    }),
    saved,
  };
}

describe('DEMO_GIFS', () => {
  it('has around two dozen entries spread across every category 0008 seeds', () => {
    expect(DEMO_GIFS.length).toBeGreaterThanOrEqual(24);
    const categorySlugs = new Set(DEMO_GIFS.map((g) => g.categorySlug));
    expect(categorySlugs).toEqual(
      new Set(['reactions', 'memes', 'animals', 'sports', 'movies-tv', 'anime', 'gaming', 'other'])
    );
  });

  it('every entry has at least one tag and a title', () => {
    for (const gif of DEMO_GIFS) {
      expect(gif.title.trim().length).toBeGreaterThan(0);
      expect(gif.tags.length).toBeGreaterThan(0);
    }
  });

  it('every entry points at an asset file that actually exists on disk', () => {
    for (const gif of DEMO_GIFS) {
      expect(existsSync(path.join(ASSETS_DIR, gif.asset))).toBe(true);
    }
  });

  it('every entry has a unique logical key', () => {
    const keys = DEMO_GIFS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('demoGifId', () => {
  it('is deterministic for the same key', () => {
    expect(demoGifId('reactions-1')).toBe(demoGifId('reactions-1'));
  });

  it('differs between keys', () => {
    expect(demoGifId('reactions-1')).not.toBe(demoGifId('reactions-2'));
  });

  it('looks like a UUID, namespaced under de110000', () => {
    expect(demoGifId('animals-3')).toMatch(/^de110000-0000-4000-8000-[0-9a-f]{12}$/);
  });
});

describe('isForced / shouldRefuse', () => {
  it.each(['1', 'true', 'TRUE', 'yes', 'on'])('treats %s as forced', (value) => {
    expect(isForced(value)).toBe(true);
  });

  it.each([undefined, '', '0', 'false', 'no'])('treats %s as not forced', (value) => {
    expect(isForced(value)).toBe(false);
  });

  it('refuses in production without the force flag', () => {
    expect(shouldRefuse(true, false)).toBe(true);
  });

  it('does not refuse in production with the force flag set', () => {
    expect(shouldRefuse(true, true)).toBe(false);
  });

  it('never refuses outside production', () => {
    expect(shouldRefuse(false, false)).toBe(false);
  });

  it(`reads ${SEED_DEMO_FORCE_ENV_VAR} by default`, () => {
    const previous = process.env[SEED_DEMO_FORCE_ENV_VAR];
    process.env[SEED_DEMO_FORCE_ENV_VAR] = 'true';
    try {
      expect(isForced()).toBe(true);
    } finally {
      if (previous === undefined) delete process.env[SEED_DEMO_FORCE_ENV_VAR];
      else process.env[SEED_DEMO_FORCE_ENV_VAR] = previous;
    }
  });
});

describe('seedDemo', () => {
  it('inserts every demo gif, tags them, and attaches them to their category', async () => {
    const db = fakeDatabase();
    const storage = fakeStorage();

    const result = await seedDemo(db as never, storage as never);

    expect(result.missingCategorySlugs).toEqual([]);
    expect(result.inserted).toBe(DEMO_GIFS.length);
    expect(result.skipped).toBe(0);
    expect(db.gifsById.size).toBe(DEMO_GIFS.length);
    expect(storage.saved.length).toBe(DEMO_GIFS.length);

    // Every demo gif ends up tagged.
    for (const gif of DEMO_GIFS) {
      const gifId = demoGifId(gif.key);
      for (const tag of gif.tags) {
        const tagRecord = [...db.tagsBySlug.values()].find((t) => t.name === tag);
        expect(tagRecord).toBeTruthy();
        expect(db.gifTags.has(`${gifId}:${tagRecord!.id}`)).toBe(true);
      }
    }
  });

  it('is idempotent: a second run inserts nothing new and does not re-write storage', async () => {
    const db = fakeDatabase();
    const storage = fakeStorage();

    await seedDemo(db as never, storage as never);
    storage.save.mockClear();
    const second = await seedDemo(db as never, storage as never);

    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(DEMO_GIFS.length);
    expect(db.gifsById.size).toBe(DEMO_GIFS.length);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('skips gifs whose category is missing instead of failing the whole run', async () => {
    const db = fakeDatabase({ categories: [{ id: 'cat-reactions', slug: 'reactions' }] });
    const storage = fakeStorage();

    const result = await seedDemo(db as never, storage as never);

    const reactionsCount = DEMO_GIFS.filter((g) => g.categorySlug === 'reactions').length;
    expect(result.inserted).toBe(reactionsCount);
    expect(result.skipped).toBe(DEMO_GIFS.length - reactionsCount);
    expect(result.missingCategorySlugs.sort()).toEqual(
      [...new Set(DEMO_GIFS.map((g) => g.categorySlug))].filter((s) => s !== 'reactions').sort()
    );
  });
});

/**
 * Regression test for L42-448: `getGifEntries()` in `src/services/sitemap.ts` queried
 * `gifs.slug` before that column existed and filtered on a non-existent `is_published` column, so
 * the query always threw and was silently swallowed by the surrounding try/catch - `/sitemap.xml`
 * never actually listed a single GIF (see the issue for the full trail). The existing
 * `test/sitemap.test.ts` suite only exercises the "no reachable Postgres" fallback path, so this
 * regressed unnoticed; this file exercises the success path with a mocked pool instead, so a
 * future schema/query drift fails loudly here rather than being swallowed again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../src/db/pool', () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

const { getAllSitemapEntries } = await import('../src/services/sitemap');

const GIF_ROW = { slug: 'clapping-cat-4f9a1c', updated_at: '2024-01-05T00:00:00.000Z' };
const CATEGORY_ROW = { slug: 'animals', updated_at: '2024-01-04T00:00:00.000Z' };

describe('getAllSitemapEntries - GIF URLs', () => {
  afterEach(() => {
    queryMock.mockReset();
  });

  it('includes /gif/:slug URLs for active gifs, querying only status = \'active\' rows', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM gifs')) {
        expect(sql).toContain("status = 'active'");
        return { rows: [GIF_ROW] };
      }
      if (sql.includes('FROM categories')) {
        return { rows: [CATEGORY_ROW] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const entries = await getAllSitemapEntries();
    const locs = entries.map((entry) => entry.loc);

    expect(locs).toContain('http://localhost:3000/gif/clapping-cat-4f9a1c');
    expect(locs).toContain('http://localhost:3000/category/animals');
  });

  it('still degrades to zero GIF entries (no throw) if the query fails', async () => {
    queryMock.mockImplementation(async () => {
      throw new Error('relation "gifs" does not exist');
    });

    const entries = await getAllSitemapEntries();
    expect(entries.some((entry) => entry.loc.includes('/gif/'))).toBe(false);
  });
});

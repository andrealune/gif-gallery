import { describe, expect, it, vi } from 'vitest';
import { PostgresGifSearchFallback } from '../../src/search/postgresFallback';

interface FakeRow {
  id: string;
  title?: string;
  category_id?: string | null;
  total_count: string;
}

function fakeDatabase(rows: FakeRow[]) {
  return {
    query: vi.fn(async () => ({
      rows: rows.map((row) => ({
        id: row.id,
        source: 'tenor',
        title: row.title ?? `Gif ${row.id}`,
        description: null,
        category_id: row.category_id ?? null,
        url: `https://example.com/${row.id}.gif`,
        thumbnail_url: null,
        width: 100,
        height: 100,
        file_size_bytes: 1000,
        duration_ms: 500,
        mime_type: 'image/gif',
        status: 'active',
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-01-02T00:00:00.000Z'),
        total_count: row.total_count,
      })),
    })),
  };
}

describe('PostgresGifSearchFallback.search', () => {
  it('runs a plainto_tsquery full-text search and maps rows to GifSummary, tagged degraded', async () => {
    const db = fakeDatabase([
      { id: 'a', total_count: '2' },
      { id: 'b', total_count: '2' },
    ]);
    const fallback = new PostgresGifSearchFallback(db as never);

    const result = await fallback.search({ q: 'cat', limit: 20, offset: 0 });

    expect(result.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.total).toBe(2);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.degraded).toBe(true);

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('plainto_tsquery'),
      ['cat', '%cat%', null, 20, 0]
    );
  });

  it('returns an empty page with total 0 when there are no matches', async () => {
    const db = fakeDatabase([]);
    const fallback = new PostgresGifSearchFallback(db as never);

    const result = await fallback.search({ q: 'nonexistent', limit: 20, offset: 0 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.degraded).toBe(true);
  });

  it('passes the optional category (id or slug) straight through as a query parameter', async () => {
    const db = fakeDatabase([]);
    const fallback = new PostgresGifSearchFallback(db as never);

    await fallback.search({ q: 'cat', category: 'animals', limit: 5, offset: 10 });

    expect(db.query).toHaveBeenCalledWith(expect.any(String), ['cat', '%cat%', 'animals', 5, 10]);
  });

  it('defaults to the shared pool when no database is supplied', () => {
    expect(() => new PostgresGifSearchFallback()).not.toThrow();
  });
});

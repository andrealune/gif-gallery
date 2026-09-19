import { describe, expect, it, vi } from 'vitest';
import { GifSearchQueryService } from '../../src/search/searchService';

interface FakeHit {
  id: string;
  score: number;
}

/** Minimal fake of the `client.search()` surface `GifSearchQueryService` uses. */
function fakeEsClient(hits: FakeHit[], total: number | { value: number; relation: string } = hits.length) {
  return {
    search: vi.fn(async () => ({
      hits: {
        total,
        hits: hits.map((hit) => ({ _id: hit.id, _score: hit.score })),
      },
    })),
  };
}

interface FakeRow {
  id: string;
  category_id: string | null;
}

function fakeDatabase(rows: FakeRow[]) {
  return {
    query: vi.fn(async () => ({
      rows: rows.map((row) => ({
        id: row.id,
        source: 'tenor',
        title: `Gif ${row.id}`,
        description: null,
        category_id: row.category_id,
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
      })),
    })),
  };
}

describe('GifSearchQueryService.search', () => {
  it('hydrates Elasticsearch hits from Postgres, preserving ES ranking order', async () => {
    const es = fakeEsClient([{ id: 'b', score: 2 }, { id: 'a', score: 1 }], 2);
    // Postgres returns them in a different (e.g. index) order - the service must re-order to `a, b -> b, a`.
    const db = fakeDatabase([{ id: 'a', category_id: null }, { id: 'b', category_id: null }]);
    const service = new GifSearchQueryService(es as never, db as never, 'gifs');

    const result = await service.search({ q: 'cat', limit: 20, offset: 0 });

    expect(result.items.map((item) => item.id)).toEqual(['b', 'a']);
    expect(result.total).toBe(2);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = ANY($1)'), [['b', 'a']]);
  });

  it('drops ids Elasticsearch returned but Postgres no longer has (e.g. archived since indexing)', async () => {
    const es = fakeEsClient([{ id: 'a', score: 1 }, { id: 'missing', score: 0.5 }], 2);
    const db = fakeDatabase([{ id: 'a', category_id: null }]);
    const service = new GifSearchQueryService(es as never, db as never, 'gifs');

    const result = await service.search({ q: 'cat', limit: 20, offset: 0 });

    expect(result.items.map((item) => item.id)).toEqual(['a']);
    expect(result.total).toBe(2);
  });

  it('short-circuits without querying Postgres when there are no hits', async () => {
    const es = fakeEsClient([], 0);
    const db = fakeDatabase([]);
    const service = new GifSearchQueryService(es as never, db as never, 'gifs');

    const result = await service.search({ q: 'nonexistent', limit: 20, offset: 0 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('reads total from the object form Elasticsearch uses when track_total_hits is on', async () => {
    const es = fakeEsClient([{ id: 'a', score: 1 }], { value: 42, relation: 'eq' });
    const db = fakeDatabase([{ id: 'a', category_id: null }]);
    const service = new GifSearchQueryService(es as never, db as never, 'gifs');

    const result = await service.search({ q: 'cat', limit: 20, offset: 0 });

    expect(result.total).toBe(42);
  });

  it('passes the alias, query and pagination through to the Elasticsearch request', async () => {
    const es = fakeEsClient([], 0);
    const db = fakeDatabase([]);
    const service = new GifSearchQueryService(es as never, db as never, 'gifs');

    await service.search({ q: 'cat', category: 'animals', limit: 5, offset: 10 });

    expect(es.search).toHaveBeenCalledWith(
      expect.objectContaining({ index: 'gifs', from: 10, size: 5 })
    );
  });
});

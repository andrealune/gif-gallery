import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import {
  createGifsIndex,
  currentAliasTarget,
  listVersionedIndices,
  nextIndexVersion,
  pruneOldIndices,
  reindexAllGifs,
  swapAlias,
} from '../../src/search/pipeline';
import { parseIndexVersion, versionedIndexName } from '../../src/search/gifsIndex';
import type { GifSearchSourceRow } from '../../src/search/documentMapper';

/**
 * Minimal fake of the handful of `@elastic/elasticsearch` `Client` methods
 * `pipeline.ts` uses, backed by an in-memory map of index name -> alias
 * names. Same style as `test/tenor/client.test.ts`'s fake `fetch`: no real
 * network/cluster involved, just enough surface to exercise the alias/
 * version bookkeeping logic.
 */
function fakeClient(initialIndices: Record<string, string[]> = {}) {
  const indices = new Map<string, Set<string>>(
    Object.entries(initialIndices).map(([index, aliases]) => [index, new Set(aliases)])
  );
  const deleted: string[] = [];

  const client = {
    indices: {
      async exists({ index }: { index: string }) {
        return indices.has(index);
      },
      async create({ index }: { index: string }) {
        indices.set(index, new Set());
      },
      async get({ index }: { index: string }) {
        const pattern = new RegExp(`^${index.replace(/\*/g, '.*')}$`);
        const result: Record<string, unknown> = {};
        for (const name of indices.keys()) {
          if (pattern.test(name)) result[name] = {};
        }
        return result;
      },
      async getAlias({ name }: { name: string }) {
        const result: Record<string, unknown> = {};
        for (const [index, aliases] of indices) {
          if (aliases.has(name)) result[index] = { aliases: { [name]: {} } };
        }
        return result;
      },
      async updateAliases({ actions }: { actions: Record<string, { index: string; alias: string }>[] }) {
        for (const action of actions) {
          if (action.remove) {
            indices.get(action.remove.index)?.delete(action.remove.alias);
          }
          if (action.add) {
            indices.get(action.add.index)?.add(action.add.alias);
          }
        }
      },
      async delete({ index }: { index: string }) {
        indices.delete(index);
        deleted.push(index);
      },
    },
    helpers: {
      async bulk<T>({ datasource, onDocument }: { datasource: AsyncIterable<T>; onDocument: (doc: T) => unknown }) {
        let successful = 0;
        for await (const doc of datasource) {
          onDocument(doc);
          successful += 1;
        }
        return { total: successful, successful, failed: 0, retry: 0, time: 0, bytes: 0, aborted: false };
      },
    },
  };

  return { client: client as unknown as Client, indices, deleted };
}

describe('gifsIndex naming helpers', () => {
  it('builds and parses versioned index names', () => {
    expect(versionedIndexName('gifs', 1)).toBe('gifs_v1');
    expect(parseIndexVersion('gifs', 'gifs_v1')).toBe(1);
    expect(parseIndexVersion('gifs', 'gifs_v42')).toBe(42);
    expect(parseIndexVersion('gifs', 'somethingelse')).toBeNull();
  });
});

describe('createGifsIndex', () => {
  it('creates the index when it does not exist', async () => {
    const { client, indices } = fakeClient();
    await createGifsIndex(client, 'gifs_v1');
    expect(indices.has('gifs_v1')).toBe(true);
  });

  it('is idempotent - does nothing if the index already exists', async () => {
    const { client } = fakeClient({ gifs_v1: [] });
    const createSpy = vi.spyOn(client.indices, 'create');
    await createGifsIndex(client, 'gifs_v1');
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('nextIndexVersion / listVersionedIndices', () => {
  it('returns 1 when no versioned index exists yet', async () => {
    const { client } = fakeClient();
    expect(await nextIndexVersion(client, 'gifs')).toBe(1);
  });

  it('returns max version + 1 when versions already exist', async () => {
    const { client } = fakeClient({ gifs_v1: [], gifs_v2: [], gifs_v10: [] });
    expect(await nextIndexVersion(client, 'gifs')).toBe(11);
    expect(await listVersionedIndices(client, 'gifs')).toEqual(['gifs_v1', 'gifs_v2', 'gifs_v10']);
  });
});

describe('swapAlias / currentAliasTarget', () => {
  it('points the alias at a fresh index when none existed before', async () => {
    const { client } = fakeClient({ gifs_v1: [] });
    await swapAlias(client, 'gifs', 'gifs_v1');
    expect(await currentAliasTarget(client, 'gifs')).toBe('gifs_v1');
  });

  it('moves the alias from the old index to the new one, removing it from the old one', async () => {
    const { client, indices } = fakeClient({ gifs_v1: ['gifs'], gifs_v2: [] });
    await swapAlias(client, 'gifs', 'gifs_v2');
    expect(await currentAliasTarget(client, 'gifs')).toBe('gifs_v2');
    expect(indices.get('gifs_v1')?.has('gifs')).toBe(false);
  });
});

describe('pruneOldIndices', () => {
  it('keeps the active index and the requested number of previous versions, deletes the rest', async () => {
    const { client, deleted } = fakeClient({
      gifs_v1: [],
      gifs_v2: [],
      gifs_v3: [],
      gifs_v4: ['gifs'],
    });
    const removed = await pruneOldIndices(client, 'gifs', 1);
    expect(removed).toEqual(['gifs_v1', 'gifs_v2']);
    expect(deleted).toEqual(['gifs_v1', 'gifs_v2']);
    expect(await listVersionedIndices(client, 'gifs')).toEqual(['gifs_v3', 'gifs_v4']);
  });

  it('deletes nothing when keep covers every inactive version', async () => {
    const { client, deleted } = fakeClient({ gifs_v1: [], gifs_v2: ['gifs'] });
    await pruneOldIndices(client, 'gifs', 5);
    expect(deleted).toEqual([]);
  });
});

describe('reindexAllGifs', () => {
  function sourceRow(id: string): GifSearchSourceRow {
    return {
      id,
      title: `Gif ${id}`,
      description: null,
      status: 'active',
      source: 'upload',
      url: `https://example.com/${id}.gif`,
      thumbnail_url: null,
      created_at: new Date('2024-01-01T00:00:00.000Z'),
      updated_at: new Date('2024-01-01T00:00:00.000Z'),
      category_id: null,
      category_name: null,
      category_slug: null,
      tags: [],
    };
  }

  it('pages through the source repository and bulk-indexes every document', async () => {
    const { client } = fakeClient({ gifs_v1: [] });
    const ids = ['1', '2', '3', '4', '5'];
    let calls = 0;
    const sourceRepository = {
      fetchBatch: vi.fn(async (afterId: string | null, limit: number) => {
        calls += 1;
        const startIndex = afterId ? ids.indexOf(afterId) + 1 : 0;
        return ids.slice(startIndex, startIndex + limit).map(sourceRow);
      }),
      countActive: vi.fn(async () => ids.length),
    };

    const progress: number[] = [];
    const result = await reindexAllGifs({
      client,
      targetIndex: 'gifs_v1',
      sourceRepository,
      batchSize: 2,
      onProgress: (n) => progress.push(n),
    });

    expect(result).toEqual({ targetIndex: 'gifs_v1', indexed: 5, failed: 0 });
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    // 5 ids in batches of 2 -> 3 fetches (2, 2, 1), the last one shorter than the batch size ends the loop.
    expect(calls).toBe(3);
  });

  it('returns zero indexed documents when there is nothing to index', async () => {
    const { client } = fakeClient({ gifs_v1: [] });
    const sourceRepository = {
      fetchBatch: vi.fn(async () => []),
      countActive: vi.fn(async () => 0),
    };

    const result = await reindexAllGifs({ client, targetIndex: 'gifs_v1', sourceRepository, batchSize: 500 });
    expect(result).toEqual({ targetIndex: 'gifs_v1', indexed: 0, failed: 0 });
  });
});

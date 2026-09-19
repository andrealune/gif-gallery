import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { createGifSearchSyncJob, runSyncBatch, type GifSearchSyncJob } from '../../src/search/syncJob';
import { IndexingPipelineError } from '../../src/search/errors';
import type { GifSearchSourceRow } from '../../src/search/documentMapper';

function sourceRow(id: string, status: string, updatedAt = '2024-01-01T00:00:00.000Z'): GifSearchSourceRow {
  return {
    id,
    title: `Gif ${id}`,
    description: null,
    status,
    source: 'upload',
    url: `https://example.com/${id}.gif`,
    thumbnail_url: null,
    created_at: new Date('2023-12-31T00:00:00.000Z'),
    updated_at: new Date(updatedAt),
    category_id: null,
    category_name: null,
    category_slug: null,
    tags: [],
  };
}

/**
 * Minimal fake of the `@elastic/elasticsearch` `Client.helpers.bulk` surface
 * `runSyncBatch` uses, backed by an in-memory `id -> document` map. Mirrors
 * the real client's behaviour that matters here: a delete of a document
 * that isn't present drops with `status: 404`; ids in `failIds` simulate
 * some other (non-404) per-document failure instead of applying.
 */
function fakeClient(options: { initialDocs?: Record<string, unknown>; failIds?: string[] } = {}) {
  const store = new Map<string, unknown>(Object.entries(options.initialDocs ?? {}));
  const failIds = new Set(options.failIds ?? []);

  const client = {
    helpers: {
      async bulk<T>({
        datasource,
        onDocument,
        onDrop,
      }: {
        datasource: Iterable<T> | AsyncIterable<T>;
        onDocument: (doc: T) => unknown;
        onDrop?: (dropped: { status: number; operation: unknown; document: T; error: null; retried: boolean }) => void;
      }) {
        let successful = 0;
        let failed = 0;
        for await (const doc of datasource) {
          const result = onDocument(doc);
          const [action, payload] = Array.isArray(result) ? result : [result, doc];
          const operation = Object.keys(action as object)[0] as 'index' | 'delete';
          const opBody = (action as Record<'index' | 'delete', { _id: string }>)[operation];

          if (operation === 'index') {
            if (failIds.has(opBody._id)) {
              failed += 1;
              onDrop?.({ status: 500, operation: action, document: doc, error: null, retried: false });
            } else {
              store.set(opBody._id, payload);
              successful += 1;
            }
            continue;
          }

          if (store.has(opBody._id)) {
            store.delete(opBody._id);
            successful += 1;
          } else {
            failed += 1;
            onDrop?.({ status: 404, operation: action, document: doc, error: null, retried: false });
          }
        }
        return { total: successful + failed, successful, failed, retry: 0, time: 0, bytes: 0, aborted: false };
      },
    },
  };

  return { client: client as unknown as Client, store };
}

describe('runSyncBatch', () => {
  it('upserts active rows and deletes non-active rows, advancing the cursor to the last row', async () => {
    const { client, store } = fakeClient({ initialDocs: { '2': { stale: true } } });
    const rows = [sourceRow('1', 'active'), sourceRow('2', 'archived', '2024-01-01T00:00:01.000Z')];
    const fetchChanges = vi.fn(async () => rows);

    const result = await runSyncBatch({
      client,
      cursor: null,
      sourceRepository: { fetchChanges },
      batchSize: 50,
    });

    expect(fetchChanges).toHaveBeenCalledWith(null, 50);
    expect(result).toEqual({
      cursor: { updatedAt: '2024-01-01T00:00:01.000Z', id: '2' },
      processed: 2,
      indexed: 1,
      deleted: 1,
    });
    expect(store.has('1')).toBe(true);
    expect(store.has('2')).toBe(false);
  });

  it('treats deleting an already-absent document (404) as success, not a failure', async () => {
    const { client } = fakeClient(); // '3' was never indexed
    const rows = [sourceRow('3', 'flagged')];

    const result = await runSyncBatch({
      client,
      cursor: null,
      sourceRepository: { fetchChanges: async () => rows },
    });

    expect(result.deleted).toBe(1);
  });

  it('throws IndexingPipelineError when a document fails for a reason other than a missing delete', async () => {
    const { client } = fakeClient({ failIds: ['1'] });
    const rows = [sourceRow('1', 'active')];

    await expect(
      runSyncBatch({ client, cursor: null, sourceRepository: { fetchChanges: async () => rows } })
    ).rejects.toThrow(IndexingPipelineError);
  });

  it('returns the same cursor and zero counts when there is nothing new to sync', async () => {
    const { client } = fakeClient();
    const cursor = { updatedAt: '2024-01-01T00:00:00.000Z', id: '1' };

    const result = await runSyncBatch({
      client,
      cursor,
      sourceRepository: { fetchChanges: async () => [] },
    });

    expect(result).toEqual({ cursor, processed: 0, indexed: 0, deleted: 0 });
  });

  it('accepts an updated_at delivered as a string, not just a Date (as the pg driver may return it)', async () => {
    const { client } = fakeClient();
    const row = { ...sourceRow('1', 'active'), updated_at: '2024-02-02T00:00:00.000Z' };

    const result = await runSyncBatch({
      client,
      cursor: null,
      sourceRepository: { fetchChanges: async () => [row] },
    });

    expect(result.cursor).toEqual({ updatedAt: '2024-02-02T00:00:00.000Z', id: '1' });
  });
});

describe('createGifSearchSyncJob', () => {
  it('defaults the initial cursor to now minus the startup overlap window, pinned to the lowest possible id', () => {
    const { client } = fakeClient();
    const job = createGifSearchSyncJob({
      client,
      startupOverlapMs: 60_000,
      now: () => new Date('2024-06-01T00:01:00.000Z'),
    });

    expect(job.cursor).toEqual({
      updatedAt: '2024-06-01T00:00:00.000Z',
      id: '00000000-0000-0000-0000-000000000000',
    });
  });

  it('honours an explicit initialCursor (including null, to sync from the very beginning)', () => {
    const { client } = fakeClient();
    const job = createGifSearchSyncJob({ client, initialCursor: null });
    expect(job.cursor).toBeNull();
  });

  it('drains every available page before waiting for the next interval, and stop() settles cleanly', async () => {
    const { client, store } = fakeClient();
    const pages: GifSearchSourceRow[][] = [
      [sourceRow('1', 'active'), sourceRow('2', 'active')],
      [sourceRow('3', 'active')],
    ];
    const fetchChanges = vi.fn(async () => pages.shift() ?? []);

    const job: GifSearchSyncJob = createGifSearchSyncJob({
      client,
      sourceRepository: { fetchChanges },
      batchSize: 2,
      intervalMs: 1,
      initialCursor: null,
    });

    job.start();
    // Real (tiny) delay: give the in-process poll loop a few ticks to drain
    // both pages and start waiting on the interval.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await job.stop();

    expect(store.has('1')).toBe(true);
    expect(store.has('2')).toBe(true);
    expect(store.has('3')).toBe(true);
    expect(fetchChanges.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Every page after the two seeded ones comes back empty; the cursor stays
    // at the last real row rather than being reset.
    expect(job.cursor).toEqual({ updatedAt: '2024-01-01T00:00:00.000Z', id: '3' });
  });

  it('reports a failed batch via onError and keeps polling from the same cursor instead of crashing', async () => {
    const { client } = fakeClient({ failIds: ['1'] });
    const row = sourceRow('1', 'active');
    const fetchChanges = vi.fn(async () => [row]);
    const onError = vi.fn();

    const job = createGifSearchSyncJob({
      client,
      sourceRepository: { fetchChanges },
      batchSize: 10,
      intervalMs: 1,
      initialCursor: null,
      onError,
    });

    job.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await job.stop();

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(IndexingPipelineError);
    // The failing batch never advanced the cursor - every retry re-fetches from scratch.
    expect(job.cursor).toBeNull();
  });

  it('start() is idempotent and stop() is safe to call without ever starting', async () => {
    const { client } = fakeClient();
    const fetchChanges = vi.fn(async () => []);
    const job = createGifSearchSyncJob({ client, sourceRepository: { fetchChanges }, initialCursor: null });

    await job.stop();
    job.start();
    job.start();
    await job.stop();
  });
});

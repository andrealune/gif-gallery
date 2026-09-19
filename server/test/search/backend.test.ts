import { describe, expect, it } from 'vitest';
import { createGifSearchQueryService, resolveSearchBackend } from '../../src/search/backend';
import { PostgresGifSearchQueryService } from '../../src/search/postgresSearchService';
import { GifSearchQueryService } from '../../src/search/searchService';

describe('resolveSearchBackend', () => {
  it('forces elasticsearch when SEARCH_BACKEND=elasticsearch, regardless of syncEnabled', () => {
    expect(resolveSearchBackend({ search: { backend: 'elasticsearch' }, elasticsearch: { syncEnabled: false } })).toBe(
      'elasticsearch'
    );
  });

  it('forces postgres when SEARCH_BACKEND=postgres, regardless of syncEnabled', () => {
    expect(resolveSearchBackend({ search: { backend: 'postgres' }, elasticsearch: { syncEnabled: true } })).toBe(
      'postgres'
    );
  });

  it('auto infers elasticsearch when ELASTICSEARCH_SYNC_ENABLED is true', () => {
    expect(resolveSearchBackend({ search: { backend: 'auto' }, elasticsearch: { syncEnabled: true } })).toBe(
      'elasticsearch'
    );
  });

  it('auto infers postgres when ELASTICSEARCH_SYNC_ENABLED is false (every preview environment, ADR 0001)', () => {
    expect(resolveSearchBackend({ search: { backend: 'auto' }, elasticsearch: { syncEnabled: false } })).toBe(
      'postgres'
    );
  });
});

describe('createGifSearchQueryService', () => {
  it('builds a PostgresGifSearchQueryService when the resolved backend is postgres', () => {
    const service = createGifSearchQueryService({ search: { backend: 'postgres' }, elasticsearch: { syncEnabled: true } });
    expect(service).toBeInstanceOf(PostgresGifSearchQueryService);
  });

  it('builds a GifSearchQueryService when the resolved backend is elasticsearch', () => {
    const service = createGifSearchQueryService({ search: { backend: 'elasticsearch' }, elasticsearch: { syncEnabled: false } });
    expect(service).toBeInstanceOf(GifSearchQueryService);
  });
});

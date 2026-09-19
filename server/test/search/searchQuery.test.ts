import { describe, expect, it } from 'vitest';
import { buildSearchRequest } from '../../src/search/searchQuery';

describe('buildSearchRequest', () => {
  it('builds a ranked multi_match query scoped to the given alias, filtered to active gifs', () => {
    const request = buildSearchRequest('gifs', { q: 'dancing cat', limit: 20, offset: 0 });

    expect(request.index).toBe('gifs');
    expect(request.from).toBe(0);
    expect(request.size).toBe(20);
    expect(request.track_total_hits).toBe(true);
    expect(request._source).toBe(false);

    const query = request.query as {
      bool: { must: Array<{ multi_match: { query: string; fields: string[] } }>; filter: unknown[] };
    };
    expect(query.bool.must[0].multi_match.query).toBe('dancing cat');
    expect(query.bool.must[0].multi_match.fields).toEqual([
      'title^3',
      'description',
      'tags.text',
      'category.name',
    ]);
    expect(query.bool.filter).toEqual([{ term: { status: 'active' } }]);
  });

  it('passes through limit/offset as size/from', () => {
    const request = buildSearchRequest('gifs', { q: 'cat', limit: 10, offset: 30 });
    expect(request.from).toBe(30);
    expect(request.size).toBe(10);
  });

  it('adds a category.id term filter when category looks like a UUID', () => {
    const request = buildSearchRequest('gifs', {
      q: 'cat',
      category: '11111111-1111-1111-1111-111111111111',
      limit: 20,
      offset: 0,
    });

    const query = request.query as { bool: { filter: unknown[] } };
    expect(query.bool.filter).toEqual([
      { term: { status: 'active' } },
      { term: { 'category.id': '11111111-1111-1111-1111-111111111111' } },
    ]);
  });

  it('adds a category.slug term filter when category is not a UUID', () => {
    const request = buildSearchRequest('gifs', { q: 'cat', category: 'animals', limit: 20, offset: 0 });

    const query = request.query as { bool: { filter: unknown[] } };
    expect(query.bool.filter).toEqual([
      { term: { status: 'active' } },
      { term: { 'category.slug': 'animals' } },
    ]);
  });

  it('omits the category filter entirely when no category is given', () => {
    const request = buildSearchRequest('gifs', { q: 'cat', limit: 20, offset: 0 });
    const query = request.query as { bool: { filter: unknown[] } };
    expect(query.bool.filter).toHaveLength(1);
  });
});

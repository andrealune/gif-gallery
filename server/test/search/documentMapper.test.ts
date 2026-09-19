import { describe, expect, it } from 'vitest';
import { toGifDocument, type GifSearchSourceRow } from '../../src/search/documentMapper';

function row(overrides: Partial<GifSearchSourceRow> = {}): GifSearchSourceRow {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    title: 'Excited cat',
    description: 'A cat jumping excitedly',
    status: 'active',
    source: 'tenor',
    url: 'https://media.example.com/cat.gif',
    thumbnail_url: 'https://media.example.com/cat-thumb.gif',
    created_at: new Date('2024-01-01T00:00:00.000Z'),
    updated_at: new Date('2024-01-02T00:00:00.000Z'),
    category_id: 'b1b2c3d4-0000-4000-8000-000000000002',
    category_name: 'Animals',
    category_slug: 'animals',
    tags: ['cat', 'excited'],
    ...overrides,
  };
}

describe('toGifDocument', () => {
  it('maps a fully-populated row to the search document shape', () => {
    expect(toGifDocument(row())).toEqual({
      id: 'a1b2c3d4-0000-4000-8000-000000000001',
      title: 'Excited cat',
      description: 'A cat jumping excitedly',
      tags: ['cat', 'excited'],
      category: { id: 'b1b2c3d4-0000-4000-8000-000000000002', name: 'Animals', slug: 'animals' },
      status: 'active',
      source: 'tenor',
      url: 'https://media.example.com/cat.gif',
      thumbnailUrl: 'https://media.example.com/cat-thumb.gif',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
  });

  it('maps a gif with no category to category: null', () => {
    const doc = toGifDocument(row({ category_id: null, category_name: null, category_slug: null }));
    expect(doc.category).toBeNull();
  });

  it('maps a gif with no tags to an empty array, not null', () => {
    const doc = toGifDocument(row({ tags: null }));
    expect(doc.tags).toEqual([]);
  });

  it('accepts timestamps as strings (as Postgres driver rows may deliver them) as well as Dates', () => {
    const doc = toGifDocument(row({ created_at: '2024-03-01T12:30:00.000Z' }));
    expect(doc.createdAt).toBe('2024-03-01T12:30:00.000Z');
  });

  it('passes through a null description unchanged', () => {
    const doc = toGifDocument(row({ description: null }));
    expect(doc.description).toBeNull();
  });
});

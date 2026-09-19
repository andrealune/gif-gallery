import { describe, expect, it, vi } from 'vitest';
import { GifRepository } from '../../src/services/gifs';

function fakePool(handler: (sql: string, params?: unknown[]) => { rows: unknown[] }) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params));
  return { query };
}

const GIF_ROW = {
  id: '22222222-2222-2222-2222-222222222222',
  source: 'tenor',
  title: 'Cat jumping',
  description: null,
  category_id: '11111111-1111-1111-1111-111111111111',
  url: 'https://media.tenor.com/cat.gif',
  thumbnail_url: 'https://media.tenor.com/cat-tiny.gif',
  slug: 'cat-jumping-a1b2c3',
  width: 320,
  height: 240,
  file_size_bytes: '123456',
  duration_ms: 1500,
  mime_type: 'image/gif',
  status: 'active',
  created_at: '2024-01-03T00:00:00.000Z',
  updated_at: '2024-01-03T00:00:00.000Z',
};

describe('GifRepository', () => {
  describe('findGif', () => {
    it('filters by id when given a UUID', async () => {
      const fake = fakePool(() => ({ rows: [GIF_ROW] }));
      const repo = new GifRepository(fake as never);

      const result = await repo.findGif('22222222-2222-2222-2222-222222222222');

      expect(result).toEqual({
        id: GIF_ROW.id,
        source: 'tenor',
        title: 'Cat jumping',
        description: null,
        categoryId: '11111111-1111-1111-1111-111111111111',
        url: 'https://media.tenor.com/cat.gif',
        thumbnailUrl: 'https://media.tenor.com/cat-tiny.gif',
        slug: 'cat-jumping-a1b2c3',
        width: 320,
        height: 240,
        fileSizeBytes: 123456,
        durationMs: 1500,
        mimeType: 'image/gif',
        status: 'active',
        createdAt: '2024-01-03T00:00:00.000Z',
        updatedAt: '2024-01-03T00:00:00.000Z',
      });

      const [sql, params] = fake.query.mock.calls[0];
      expect(sql).toContain('WHERE id = $1');
      expect(sql).toContain("status = 'active'");
      expect(params).toEqual(['22222222-2222-2222-2222-222222222222']);
    });

    it('filters by slug when not given a UUID', async () => {
      const fake = fakePool(() => ({ rows: [GIF_ROW] }));
      const repo = new GifRepository(fake as never);

      const result = await repo.findGif('cat-jumping-a1b2c3');

      expect(result?.slug).toBe('cat-jumping-a1b2c3');
      const [sql, params] = fake.query.mock.calls[0];
      expect(sql).toContain('WHERE slug = $1');
      expect(params).toEqual(['cat-jumping-a1b2c3']);
    });

    it('returns null when no row matches', async () => {
      const fake = fakePool(() => ({ rows: [] }));
      const repo = new GifRepository(fake as never);

      const result = await repo.findGif('does-not-exist');

      expect(result).toBeNull();
    });
  });
});

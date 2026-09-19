import { describe, expect, it, vi } from 'vitest';
import { CategoryRepository } from '../../src/services/categories';

function fakePool(handler: (sql: string, params?: unknown[]) => { rows: unknown[] }) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params));
  return { query };
}

const CATEGORY_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Animals',
  slug: 'animals',
  description: 'Cute critters',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-02T00:00:00.000Z',
  gif_count: '3',
};

const GIF_ROW = {
  id: '22222222-2222-2222-2222-222222222222',
  source: 'tenor',
  title: 'Cat jumping',
  description: null,
  category_id: '11111111-1111-1111-1111-111111111111',
  url: 'https://media.tenor.com/cat.gif',
  thumbnail_url: 'https://media.tenor.com/cat-tiny.gif',
  width: 320,
  height: 240,
  file_size_bytes: '123456',
  duration_ms: 1500,
  mime_type: 'image/gif',
  status: 'active',
  created_at: '2024-01-03T00:00:00.000Z',
  updated_at: '2024-01-03T00:00:00.000Z',
};

describe('CategoryRepository', () => {
  describe('listCategories', () => {
    it('returns categories with numeric gif counts and pagination info', async () => {
      const fake = fakePool((sql) => {
        if (sql.includes('FROM categories c')) return { rows: [CATEGORY_ROW] };
        if (sql.includes('SELECT COUNT(*)::int AS count FROM categories')) return { rows: [{ count: 8 }] };
        throw new Error(`unexpected query: ${sql}`);
      });

      const repo = new CategoryRepository(fake as never);
      const page = await repo.listCategories({ limit: 50, offset: 0 });

      expect(page).toEqual({
        items: [
          {
            id: CATEGORY_ROW.id,
            name: 'Animals',
            slug: 'animals',
            description: 'Cute critters',
            gifCount: 3,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
        total: 8,
        limit: 50,
        offset: 0,
      });

      const [sql, params] = fake.query.mock.calls[0];
      expect(sql).toContain('LEFT JOIN gifs g ON g.category_id = c.id');
      expect(sql).toContain('LIMIT $1 OFFSET $2');
      expect(params).toEqual([50, 0]);
    });
  });

  describe('findCategory', () => {
    it('filters by id when given a UUID', async () => {
      const fake = fakePool(() => ({ rows: [CATEGORY_ROW] }));
      const repo = new CategoryRepository(fake as never);

      const result = await repo.findCategory('11111111-1111-1111-1111-111111111111');

      expect(result?.slug).toBe('animals');
      const [sql, params] = fake.query.mock.calls[0];
      expect(sql).toContain('WHERE c.id = $1');
      expect(params).toEqual(['11111111-1111-1111-1111-111111111111']);
    });

    it('filters by slug when not given a UUID', async () => {
      const fake = fakePool(() => ({ rows: [CATEGORY_ROW] }));
      const repo = new CategoryRepository(fake as never);

      await repo.findCategory('animals');

      const [sql, params] = fake.query.mock.calls[0];
      expect(sql).toContain('WHERE c.slug = $1');
      expect(params).toEqual(['animals']);
    });

    it('returns null when nothing matches', async () => {
      const fake = fakePool(() => ({ rows: [] }));
      const repo = new CategoryRepository(fake as never);

      expect(await repo.findCategory('does-not-exist')).toBeNull();
    });
  });

  describe('listGifsByCategory', () => {
    it('lists active gifs for the category id, newest first, with pagination', async () => {
      const fake = fakePool((sql) => {
        if (sql.includes('FROM gifs') && sql.includes('LIMIT')) return { rows: [GIF_ROW] };
        if (sql.includes('SELECT COUNT(*)::int AS count FROM gifs')) return { rows: [{ count: 1 }] };
        throw new Error(`unexpected query: ${sql}`);
      });

      const repo = new CategoryRepository(fake as never);
      const page = await repo.listGifsByCategory('11111111-1111-1111-1111-111111111111', {
        limit: 20,
        offset: 0,
      });

      expect(page.total).toBe(1);
      expect(page.items).toEqual([
        {
          id: GIF_ROW.id,
          source: 'tenor',
          title: 'Cat jumping',
          description: null,
          categoryId: '11111111-1111-1111-1111-111111111111',
          url: 'https://media.tenor.com/cat.gif',
          thumbnailUrl: 'https://media.tenor.com/cat-tiny.gif',
          width: 320,
          height: 240,
          fileSizeBytes: 123456,
          durationMs: 1500,
          mimeType: 'image/gif',
          status: 'active',
          createdAt: '2024-01-03T00:00:00.000Z',
          updatedAt: '2024-01-03T00:00:00.000Z',
        },
      ]);

      const listCall = fake.query.mock.calls.find(([sql]) => sql.includes('ORDER BY created_at DESC'));
      expect(listCall?.[1]).toEqual(['11111111-1111-1111-1111-111111111111', 20, 0]);

      const countCall = fake.query.mock.calls.find(([sql]) => sql.includes('SELECT COUNT(*)::int AS count FROM gifs'));
      expect(countCall?.[0]).toContain("status = 'active'");
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { CategoryHasGenerationPromptsError, CategoryRepository } from '../../src/services/categories';

function fakePool(handler: (sql: string, params?: unknown[]) => { rows: unknown[] }) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params));
  return { query };
}

const CATEGORY_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Animals',
  slug: 'animals',
  description: 'Cute critters',
  thumbnail_url: 'https://media.tenor.com/animals-thumb.gif',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-02T00:00:00.000Z',
  gif_count: '3',
};

const CATEGORY_ROW_WITHOUT_THUMBNAIL = {
  ...CATEGORY_ROW,
  id: '33333333-3333-3333-3333-333333333333',
  slug: 'other',
  thumbnail_url: null,
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
            thumbnailUrl: 'https://media.tenor.com/animals-thumb.gif',
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
      expect(sql).toContain('c.thumbnail_url');
      expect(sql).toContain('LIMIT $1 OFFSET $2');
      expect(params).toEqual([50, 0]);
    });

    it('maps a null thumbnail_url column to thumbnailUrl: null', async () => {
      const fake = fakePool((sql) => {
        if (sql.includes('FROM categories c')) return { rows: [CATEGORY_ROW_WITHOUT_THUMBNAIL] };
        if (sql.includes('SELECT COUNT(*)::int AS count FROM categories')) return { rows: [{ count: 1 }] };
        throw new Error(`unexpected query: ${sql}`);
      });

      const repo = new CategoryRepository(fake as never);
      const page = await repo.listCategories({ limit: 50, offset: 0 });

      expect(page.items[0].thumbnailUrl).toBeNull();
    });
  });

  describe('findCategory', () => {
    it('filters by id when given a UUID', async () => {
      const fake = fakePool(() => ({ rows: [CATEGORY_ROW] }));
      const repo = new CategoryRepository(fake as never);

      const result = await repo.findCategory('11111111-1111-1111-1111-111111111111');

      expect(result?.slug).toBe('animals');
      expect(result?.thumbnailUrl).toBe('https://media.tenor.com/animals-thumb.gif');
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
  // L42-444: deleting a category must not silently cascade into generation_prompts (ON DELETE
  // RESTRICT / ADR-0001). These are mock-level unit tests of the query sequencing; see
  // `test/categories/deleteCategory.integration.test.ts` for the real-Postgres-semantics coverage
  // (actual SQLSTATE 23503, actual FK) that the mocks here stand in for.
  describe('deleteCategory', () => {
    it('throws a 404 HttpError when the category does not exist, without querying generation_prompts', async () => {
      const fake = fakePool((sql) => {
        if (sql.includes('FROM categories c')) return { rows: [] };
        throw new Error(`unexpected query: ${sql}`);
      });
      const repo = new CategoryRepository(fake as never);

      await expect(repo.deleteCategory('does-not-exist')).rejects.toMatchObject({ status: 404 });
      expect(fake.query.mock.calls.some(([sql]) => sql.includes('generation_prompts'))).toBe(false);
    });

    it('deletes the category when there are no blocking generation_prompts', async () => {
      const fake = fakePool((sql) => {
        if (sql.includes('FROM categories c')) return { rows: [CATEGORY_ROW] };
        if (sql.includes('FROM generation_prompts')) return { rows: [{ count: 0 }] };
        if (sql.startsWith('DELETE FROM categories')) return { rows: [] };
        throw new Error(`unexpected query: ${sql}`);
      });
      const repo = new CategoryRepository(fake as never);

      await repo.deleteCategory(CATEGORY_ROW.id);

      const deleteCall = fake.query.mock.calls.find(([sql]) => sql.startsWith('DELETE FROM categories'));
      expect(deleteCall?.[1]).toEqual([CATEGORY_ROW.id]);
    });

    it('throws CategoryHasGenerationPromptsError (409) with the blocking count and never issues the DELETE', async () => {
      const fake = fakePool((sql) => {
        if (sql.includes('FROM categories c')) return { rows: [CATEGORY_ROW] };
        if (sql.includes('FROM generation_prompts')) return { rows: [{ count: 2 }] };
        throw new Error(`unexpected query: ${sql}`);
      });
      const repo = new CategoryRepository(fake as never);

      await expect(repo.deleteCategory(CATEGORY_ROW.id)).rejects.toMatchObject({
        status: 409,
        code: CategoryHasGenerationPromptsError.CODE,
        blockingPromptCount: 2,
      });
      expect(fake.query.mock.calls.some(([sql]) => sql.startsWith('DELETE FROM categories'))).toBe(false);
    });

    it('treats a 23503 raised by the DELETE itself the same way, re-counting to keep the count accurate (race-condition safety net)', async () => {
      let deleteAttempted = false;
      const fake = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FROM categories c')) return { rows: [CATEGORY_ROW] };
          if (sql.includes('FROM generation_prompts')) return { rows: [{ count: deleteAttempted ? 1 : 0 }] };
          if (sql.startsWith('DELETE FROM categories')) {
            deleteAttempted = true;
            const err = new Error('violates foreign key constraint "generation_prompts_category_id_fkey"') as Error & {
              code: string;
              constraint: string;
            };
            err.code = '23503';
            err.constraint = 'generation_prompts_category_id_fkey';
            throw err;
          }
          throw new Error(`unexpected query: ${sql}`);
        }),
      };
      const repo = new CategoryRepository(fake as never);

      await expect(repo.deleteCategory(CATEGORY_ROW.id)).rejects.toMatchObject({
        status: 409,
        code: CategoryHasGenerationPromptsError.CODE,
        blockingPromptCount: 1,
      });
    });

    it('rethrows an unrelated database error unchanged', async () => {
      const fake = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('FROM categories c')) return { rows: [CATEGORY_ROW] };
          if (sql.includes('FROM generation_prompts')) return { rows: [{ count: 0 }] };
          if (sql.startsWith('DELETE FROM categories')) throw new Error('connection reset');
          throw new Error(`unexpected query: ${sql}`);
        }),
      };
      const repo = new CategoryRepository(fake as never);

      await expect(repo.deleteCategory(CATEGORY_ROW.id)).rejects.toThrow('connection reset');
    });
  });
});

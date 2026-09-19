import { describe, expect, it, vi } from 'vitest';
import { GifSearchSourceRepository } from '../../src/search/repository';

function fakePool(handler: (sql: string, params?: unknown[]) => { rows: unknown[] }) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => handler(sql, params));
  return { query };
}

describe('GifSearchSourceRepository', () => {
  describe('fetchBatch', () => {
    it('queries only active gifs, passing the cursor and limit through', async () => {
      const rows = [{ id: '1' }];
      const fake = fakePool((sql, params) => {
        expect(sql).toContain("status = 'active'");
        expect(params).toEqual(['abc', 50]);
        return { rows };
      });

      const repo = new GifSearchSourceRepository(fake as never);
      await expect(repo.fetchBatch('abc', 50)).resolves.toBe(rows);
    });

    it('passes null through for the first page', async () => {
      const fake = fakePool((_sql, params) => {
        expect(params).toEqual([null, 10]);
        return { rows: [] };
      });

      const repo = new GifSearchSourceRepository(fake as never);
      await repo.fetchBatch(null, 10);
    });
  });

  describe('countActive', () => {
    it('parses the count as a number', async () => {
      const fake = fakePool((sql) => {
        expect(sql).toContain("status = 'active'");
        return { rows: [{ count: '42' }] };
      });

      const repo = new GifSearchSourceRepository(fake as never);
      await expect(repo.countActive()).resolves.toBe(42);
    });

    it('returns 0 when the query returns no rows', async () => {
      const fake = fakePool(() => ({ rows: [] }));
      const repo = new GifSearchSourceRepository(fake as never);
      await expect(repo.countActive()).resolves.toBe(0);
    });
  });

  describe('fetchChanges', () => {
    it('does not filter by status - archived/flagged/deleted gifs must be seen too', async () => {
      const fake = fakePool((sql) => {
        expect(sql).not.toContain("status = 'active'");
        expect(sql).toContain('ORDER BY g.updated_at, g.id');
        return { rows: [] };
      });

      const repo = new GifSearchSourceRepository(fake as never);
      await repo.fetchChanges(null, 10);
    });

    it('passes two nulls for the first page ever (no cursor)', async () => {
      const fake = fakePool((_sql, params) => {
        expect(params).toEqual([null, null, 25]);
        return { rows: [] };
      });

      const repo = new GifSearchSourceRepository(fake as never);
      await repo.fetchChanges(null, 25);
    });

    it('passes the cursor updatedAt/id and limit through', async () => {
      const rows = [{ id: '2', status: 'archived' }];
      const fake = fakePool((_sql, params) => {
        expect(params).toEqual(['2024-01-01T00:00:00.000Z', '1', 100]);
        return { rows };
      });

      const repo = new GifSearchSourceRepository(fake as never);
      await expect(
        repo.fetchChanges({ updatedAt: '2024-01-01T00:00:00.000Z', id: '1' }, 100)
      ).resolves.toBe(rows);
    });
  });
});

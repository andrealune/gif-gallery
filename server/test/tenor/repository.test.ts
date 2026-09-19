import { describe, expect, it, vi } from 'vitest';
import { TenorGifRepository } from '../../src/services/tenor';
import type { TenorGif } from '../../src/services/tenor';

const sample: TenorGif = {
  id: 'external-1',
  title: 'Sample',
  contentDescription: 'Description',
  itemUrl: 'https://tenor.com/view/1',
  shareUrl: 'https://tenor.com/1.gif',
  created: 100,
  tags: ['sample'],
  media: {
    gif: { url: 'https://media.tenor.com/full.gif', dims: [320, 180], duration: 1.5, size: 999 },
    tinygif: { url: 'https://media.tenor.com/tiny.gif', dims: [100, 50], duration: 1.5, size: 100 },
  },
  raw: { id: 'external-1' },
};

function fakePool(existingGifId?: string) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT gif_id')) return { rows: existingGifId ? [{ gif_id: existingGifId }] : [] };
    if (sql.includes('INSERT INTO gifs')) return { rows: [{ id: 'new-gif-id' }] };
    return { rows: [] };
  });
  const release = vi.fn();
  return { pool: { connect: async () => ({ query, release }) }, query, release };
}

describe('TenorGifRepository', () => {
  it('inserts a GIF and provenance atomically', async () => {
    const fake = fakePool();
    const result = await new TenorGifRepository(fake.pool as never).store(sample);
    expect(result).toBe('inserted');
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO third_party_references'))).toBe(true);
    expect(fake.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(fake.release).toHaveBeenCalled();
  });

  it('refreshes an existing provider ID instead of inserting a duplicate', async () => {
    const fake = fakePool('existing-gif');
    const result = await new TenorGifRepository(fake.pool as never).store(sample);
    expect(result).toBe('updated');
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE gifs SET'))).toBe(true);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes('fetched_at = now()'))).toBe(true);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO gifs'))).toBe(false);
  });

  it('rolls back and releases the connection on write failure', async () => {
    const fake = fakePool();
    fake.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT gif_id')) return { rows: [] };
      if (sql.includes('INSERT INTO gifs')) throw new Error('db failed');
      return { rows: [] };
    });
    await expect(new TenorGifRepository(fake.pool as never).store(sample)).rejects.toThrow('db failed');
    expect(fake.query).toHaveBeenCalledWith('ROLLBACK');
    expect(fake.release).toHaveBeenCalled();
  });
});

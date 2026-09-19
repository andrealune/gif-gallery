import { describe, expect, it, vi } from 'vitest';
import { TenorGifRepository, slugifyTag } from '../../src/services/tenor';
import type { TenorGif } from '../../src/services/tenor';

const sample: TenorGif = {
  id: 'external-1',
  title: 'Sample',
  contentDescription: 'Description',
  itemUrl: 'https://tenor.com/view/1',
  shareUrl: 'https://tenor.com/1.gif',
  created: 100,
  tags: ['Sample', 'Cats & Dogs', 'sample'],
  media: {
    gif: { url: 'https://media.tenor.com/full.gif', dims: [320, 180], duration: 1.5, size: 999 },
    tinygif: { url: 'https://media.tenor.com/tiny.gif', dims: [100, 50], duration: 1.5, size: 100 },
  },
  raw: { id: 'external-1' },
};

function fakePool(existingGifId?: string) {
  let tagCounter = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT gif_id')) return { rows: existingGifId ? [{ gif_id: existingGifId }] : [] };
    if (sql.includes('INSERT INTO gifs')) return { rows: [{ id: 'new-gif-id' }] };
    if (sql.includes('INSERT INTO tags')) {
      tagCounter += 1;
      return { rows: [{ id: `tag-${tagCounter}` }] };
    }
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

  it('upserts provider tags into `tags` and links them via `gif_tags`, deduping case-insensitive duplicates', async () => {
    const fake = fakePool();
    await new TenorGifRepository(fake.pool as never).store(sample);

    const tagInserts = fake.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO tags'));
    // 'Sample' and 'sample' slugify to the same value and must be deduped before hitting the DB.
    expect(tagInserts).toHaveLength(2);
    expect(tagInserts.map(([, params]) => params)).toEqual([
      ['Sample', 'sample'],
      ['Cats & Dogs', 'cats-dogs'],
    ]);

    const gifTagInsert = fake.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO gif_tags'));
    expect(gifTagInsert?.[1]).toEqual(['new-gif-id', ['tag-1', 'tag-2']]);

    const gifTagDelete = fake.query.mock.calls.find(([sql]) => String(sql).includes('DELETE FROM gif_tags'));
    expect(gifTagDelete?.[1]).toEqual(['new-gif-id', ['tag-1', 'tag-2']]);
  });

  it('clears stale gif_tags associations when the provider reports no tags', async () => {
    const fake = fakePool('existing-gif');
    await new TenorGifRepository(fake.pool as never).store({ ...sample, tags: [] });

    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO tags'))).toBe(false);
    const gifTagDelete = fake.query.mock.calls.find(([sql]) => String(sql).includes('DELETE FROM gif_tags'));
    expect(gifTagDelete?.[1]).toEqual(['existing-gif', []]);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO gif_tags'))).toBe(false);
  });
});

describe('slugifyTag', () => {
  it('lowercases, strips diacritics and collapses non-alphanumerics to single hyphens', () => {
    expect(slugifyTag('Cats & Dogs')).toBe('cats-dogs');
    expect(slugifyTag('Café')).toBe('cafe');
    expect(slugifyTag('  leading/trailing  ')).toBe('leading-trailing');
  });

  it('returns an empty string for tags with no representable characters', () => {
    expect(slugifyTag('🎉')).toBe('');
    expect(slugifyTag('---')).toBe('');
  });
});

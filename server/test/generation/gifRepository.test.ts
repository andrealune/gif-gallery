import { describe, expect, it, vi } from 'vitest';
import { GeneratedGifRepository } from '../../src/services/generation/gifRepository';
import type { StoreGeneratedGifInput } from '../../src/services/generation/types';

const input: StoreGeneratedGifInput = {
  categoryId: 'cat-1',
  categorySlug: 'animals',
  categoryName: 'Animals',
  promptId: 'prompt-1',
  promptText: 'A cute cat dancing',
  model: 'dall-e-3',
  gif: Buffer.from('gif-bytes'),
  url: 'http://localhost:3001/storage/abc.gif',
  storagePath: '/tmp/storage/abc.gif',
  width: 480,
  height: 480,
  fileSizeBytes: 9,
};

function fakePool() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('INSERT INTO gifs')) return { rows: [{ id: 'gif-1' }] };
    return { rows: [] };
  });
  const release = vi.fn();
  return { pool: { connect: async () => ({ query, release }) }, query, release };
}

describe('GeneratedGifRepository', () => {
  it('inserts the gif and its openai provenance atomically', async () => {
    const fake = fakePool();
    const gifId = await new GeneratedGifRepository(fake.pool as never).store(input);

    expect(gifId).toBe('gif-1');
    const calls = fake.query.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toBe('BEGIN');
    expect(calls.some((sql) => sql.includes("INSERT INTO gifs") && sql.includes("'ai_generated'"))).toBe(true);
    expect(calls.some((sql) => sql.includes('INSERT INTO third_party_references') && sql.includes("'openai'"))).toBe(
      true
    );
    expect(calls.at(-1)).toBe('COMMIT');
    expect(fake.release).toHaveBeenCalled();
  });

  it('rolls back and releases the connection on write failure', async () => {
    const fake = fakePool();
    fake.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO gifs')) throw new Error('db failed');
      return { rows: [] };
    });

    await expect(new GeneratedGifRepository(fake.pool as never).store(input)).rejects.toThrow('db failed');
    expect(fake.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(fake.release).toHaveBeenCalled();
  });
});

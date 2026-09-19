import { describe, expect, it, vi } from 'vitest';
import { GenerationAttemptsRepository } from '../../src/services/generation/attemptsRepository';

describe('GenerationAttemptsRepository', () => {
  it('records a succeeded attempt with its gif and cost', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'attempt-1' }] }));
    const repo = new GenerationAttemptsRepository({ query } as never);

    const id = await repo.record({
      status: 'succeeded',
      promptId: 'prompt-1',
      categoryId: 'cat-1',
      promptText: 'A cute cat',
      model: 'dall-e-3',
      costUsd: 0.04,
      gifId: 'gif-1',
    });

    expect(id).toBe('attempt-1');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("'succeeded'");
    expect(params).toEqual(['prompt-1', 'cat-1', 'gif-1', 'A cute cat', 'dall-e-3', 0.04]);
  });

  it('records a failed attempt, tolerating a missing promptId/categoryId', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'attempt-2' }] }));
    const repo = new GenerationAttemptsRepository({ query } as never);

    const id = await repo.record({
      status: 'failed',
      promptText: 'A cute cat',
      errorCode: 'OpenAIRequestError',
      errorMessage: 'content policy violation',
    });

    expect(id).toBe('attempt-2');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("'failed'");
    expect(params).toEqual([null, null, 'A cute cat', null, null, 'OpenAIRequestError', 'content policy violation']);
  });
});

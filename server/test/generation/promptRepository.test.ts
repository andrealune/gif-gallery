import { describe, expect, it, vi } from 'vitest';
import { GenerationPromptRepository } from '../../src/services/generation/promptRepository';

function fakeDb(query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) {
  return { query: vi.fn(query) };
}

describe('GenerationPromptRepository', () => {
  describe('listCategoryPromptStatus', () => {
    it('maps rows including categories with no active prompt (BR-1)', async () => {
      const db = fakeDb(async () => ({
        rows: [
          { id: 'cat-1', slug: 'animals', name: 'Animals', has_active_prompt: true },
          { id: 'cat-2', slug: 'other', name: 'Other', has_active_prompt: false },
        ],
      }));
      const repo = new GenerationPromptRepository(db as never);

      const result = await repo.listCategoryPromptStatus();

      expect(result).toEqual([
        { categoryId: 'cat-1', categorySlug: 'animals', categoryName: 'Animals', hasActivePrompt: true },
        { categoryId: 'cat-2', categorySlug: 'other', categoryName: 'Other', hasActivePrompt: false },
      ]);
      expect(db.query.mock.calls[0][0]).toContain('EXISTS');
    });
  });

  describe('pickRandomActivePrompt', () => {
    it('returns a mapped prompt when the category has an active one', async () => {
      const db = fakeDb(async () => ({
        rows: [{ id: 'prompt-1', category_id: 'cat-1', slug: 'animals', prompt_text: 'A cute cat' }],
      }));
      const repo = new GenerationPromptRepository(db as never);

      const result = await repo.pickRandomActivePrompt('cat-1');

      expect(result).toEqual({ id: 'prompt-1', categoryId: 'cat-1', categorySlug: 'animals', promptText: 'A cute cat' });
      expect(db.query.mock.calls[0][1]).toEqual(['cat-1']);
    });

    it('returns null when the category has no active prompt', async () => {
      const db = fakeDb(async () => ({ rows: [] }));
      const repo = new GenerationPromptRepository(db as never);

      const result = await repo.pickRandomActivePrompt('cat-empty');

      expect(result).toBeNull();
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { CostBudgetExceededError } from '../../src/services/ai/errors';
import { runGenerationBatch, type GenerationBatchDeps } from '../../src/services/generation/scheduler';
import type { CategoryPromptStatus, GenerationPrompt } from '../../src/services/generation/types';

const animals: CategoryPromptStatus = { categoryId: 'cat-animals', categorySlug: 'animals', categoryName: 'Animals', hasActivePrompt: true };
const reactions: CategoryPromptStatus = {
  categoryId: 'cat-reactions',
  categorySlug: 'reactions',
  categoryName: 'Reactions',
  hasActivePrompt: true,
};
const other: CategoryPromptStatus = { categoryId: 'cat-other', categorySlug: 'other', categoryName: 'Other', hasActivePrompt: false };

function promptFor(category: CategoryPromptStatus): GenerationPrompt {
  return { id: `prompt-${category.categorySlug}`, categoryId: category.categoryId, categorySlug: category.categorySlug, promptText: `Prompt for ${category.categorySlug}` };
}

function buildDeps(overrides: Partial<GenerationBatchDeps> & { categories?: CategoryPromptStatus[] } = {}) {
  const categories = overrides.categories ?? [animals, reactions];

  const promptRepository = {
    listCategoryPromptStatus: vi.fn(async () => categories),
    pickRandomActivePrompt: vi.fn(async (categoryId: string) => {
      const category = categories.find((c) => c.categoryId === categoryId);
      return category && category.hasActivePrompt ? promptFor(category) : null;
    }),
  };
  const attemptsRepository = { record: vi.fn(async () => 'attempt-id') };
  const gifRepository = { store: vi.fn(async () => 'gif-id') };
  const aiClient = {
    generateImage: vi.fn(async () => ({ images: [{ b64Json: 'abc' }], model: 'dall-e-3', costUsd: 0.04 })),
  };
  const converter = { convert: vi.fn(async () => ({ gif: Buffer.from('gif'), frameCount: 1, width: 480, height: 480, elapsedMs: 1 })) };
  const storage = { save: vi.fn(async () => ({ url: 'http://localhost/storage/x.gif', storagePath: '/tmp/x.gif', sizeBytes: 3 })) };

  return {
    deps: {
      promptRepository,
      attemptsRepository,
      gifRepository,
      aiClient,
      converter,
      storage,
      generateFilename: () => 'fixed-name',
      ...overrides,
    } as GenerationBatchDeps,
    mocks: { promptRepository, attemptsRepository, gifRepository, aiClient, converter, storage },
  };
}

describe('runGenerationBatch', () => {
  it('generates one gif per category with an active prompt and records success', async () => {
    const { deps, mocks } = buildDeps();

    const result = await runGenerationBatch(deps);

    expect(result).toEqual({ skippedCategories: [], attempted: 2, succeeded: 2, failed: 0, stoppedOnCostBudget: false });
    expect(mocks.aiClient.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.gifRepository.store).toHaveBeenCalledTimes(2);
    expect(mocks.attemptsRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'succeeded', gifId: 'gif-id' })
    );
  });

  it('skips a category with no active prompt (BR-1) without erroring', async () => {
    const { deps, mocks } = buildDeps({ categories: [animals, other] });

    const result = await runGenerationBatch(deps);

    expect(result.skippedCategories).toEqual(['other']);
    expect(result.attempted).toBe(1);
    expect(mocks.aiClient.generateImage).toHaveBeenCalledTimes(1);
  });

  it('records a failure and continues to the next category (does not halt the batch)', async () => {
    const { deps, mocks } = buildDeps();
    mocks.aiClient.generateImage
      .mockRejectedValueOnce(new Error('content policy violation'))
      .mockResolvedValueOnce({ images: [{ b64Json: 'abc' }], model: 'dall-e-3', costUsd: 0.04 });

    const result = await runGenerationBatch(deps);

    expect(result.attempted).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(mocks.attemptsRepository.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: 'Error', errorMessage: 'content policy violation' })
    );
  });

  it('stops the whole run when the cost budget is exceeded', async () => {
    const { deps, mocks } = buildDeps();
    mocks.aiClient.generateImage.mockRejectedValueOnce(new CostBudgetExceededError(5, 4));

    const result = await runGenerationBatch(deps);

    expect(result.attempted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.stoppedOnCostBudget).toBe(true);
    expect(mocks.aiClient.generateImage).toHaveBeenCalledTimes(1);
  });

  it('treats a race (prompt deactivated between queries) as a skip, not an error', async () => {
    const { deps, mocks } = buildDeps();
    mocks.promptRepository.pickRandomActivePrompt.mockResolvedValueOnce(null);

    const result = await runGenerationBatch(deps);

    expect(result.skippedCategories).toEqual(['animals']);
    expect(result.attempted).toBe(1);
  });

  it('caps the number of categories attempted when maxCategoriesPerRun is set', async () => {
    const { deps, mocks } = buildDeps();
    (deps as GenerationBatchDeps).maxCategoriesPerRun = 1;

    const result = await runGenerationBatch(deps);

    expect(result.attempted).toBe(1);
    expect(mocks.aiClient.generateImage).toHaveBeenCalledTimes(1);
  });
});

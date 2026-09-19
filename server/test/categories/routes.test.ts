import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler';
import { createCategoriesRouter } from '../../src/routes/categories';
import type { CategoryRepositoryLike, CategorySummary, GifSummary, Page } from '../../src/services/categories';

const CATEGORY: CategorySummary = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Animals',
  slug: 'animals',
  description: 'Cute critters',
  gifCount: 2,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

const GIF: GifSummary = {
  id: '22222222-2222-2222-2222-222222222222',
  source: 'tenor',
  title: 'Cat jumping',
  description: null,
  categoryId: CATEGORY.id,
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
};

function buildApp(repository: CategoryRepositoryLike): Express {
  const app = express();
  app.use('/api/categories', createCategoriesRouter(repository));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function fakeRepository(overrides: Partial<CategoryRepositoryLike> = {}): CategoryRepositoryLike {
  return {
    listCategories: vi.fn(async (params) => ({ items: [CATEGORY], total: 1, ...params })),
    findCategory: vi.fn(async (idOrSlug: string) =>
      idOrSlug === CATEGORY.id || idOrSlug === CATEGORY.slug ? CATEGORY : null
    ),
    listGifsByCategory: vi.fn(async (_categoryId, params) => ({ items: [GIF], total: 1, ...params })),
    ...overrides,
  };
}

describe('GET /api/categories', () => {
  it('returns categories with metadata and default pagination', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/categories');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [CATEGORY],
      pagination: { limit: 50, offset: 0, total: 1 },
    });
    expect(repo.listCategories).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });

  it('honors limit/offset query params', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/categories?limit=5&offset=10');

    expect(res.status).toBe(200);
    expect(repo.listCategories).toHaveBeenCalledWith({ limit: 5, offset: 10 });
  });

  it('rejects an invalid limit with 400', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/categories?limit=0');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('limit');
  });

  it('rejects a limit above the max with 400', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/categories?limit=101');

    expect(res.status).toBe(400);
  });
});

describe('GET /api/categories/:idOrSlug', () => {
  it('returns the category by slug', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/categories/animals');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: CATEGORY });
  });

  it('returns the category by id', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get(`/api/categories/${CATEGORY.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: CATEGORY });
  });

  it('returns 404 for an unknown category', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/categories/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('does-not-exist');
  });
});

describe('GET /api/categories/:idOrSlug/gifs', () => {
  it('returns gifs for the category with pagination metadata', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/categories/animals/gifs?limit=10&offset=0');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [GIF],
      category: CATEGORY,
      pagination: { limit: 10, offset: 0, total: 1 },
    });
    expect(repo.findCategory).toHaveBeenCalledWith('animals');
    expect(repo.listGifsByCategory).toHaveBeenCalledWith(CATEGORY.id, { limit: 10, offset: 0 });
  });

  it('applies the default limit/offset when not provided', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/categories/animals/gifs');

    expect(res.status).toBe(200);
    expect(repo.listGifsByCategory).toHaveBeenCalledWith(CATEGORY.id, { limit: 20, offset: 0 });
  });

  it('returns 404 for an unknown category without querying gifs', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/categories/does-not-exist/gifs');

    expect(res.status).toBe(404);
    expect(repo.listGifsByCategory).not.toHaveBeenCalled();
  });

  it('rejects a negative offset with 400', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/categories/animals/gifs?offset=-1');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('offset');
  });
});

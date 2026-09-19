import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler';
import { createGifsRouter } from '../../src/routes/gifs';
import type { GifDetail, GifRepositoryLike } from '../../src/services/gifs';

const GIF: GifDetail = {
  id: '22222222-2222-2222-2222-222222222222',
  source: 'tenor',
  title: 'Cat jumping',
  description: 'A cat jumping over a fence',
  categoryId: '11111111-1111-1111-1111-111111111111',
  url: 'https://media.tenor.com/cat.gif',
  thumbnailUrl: 'https://media.tenor.com/cat-tiny.gif',
  slug: 'cat-jumping-a1b2c3',
  width: 320,
  height: 240,
  fileSizeBytes: 123456,
  durationMs: 1500,
  mimeType: 'image/gif',
  status: 'active',
  createdAt: '2024-01-03T00:00:00.000Z',
  updatedAt: '2024-01-03T00:00:00.000Z',
};

function buildApp(repository: GifRepositoryLike): Express {
  const app = express();
  app.use('/api/gifs', createGifsRouter(repository));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function fakeRepository(overrides: Partial<GifRepositoryLike> = {}): GifRepositoryLike {
  return {
    findGif: vi.fn(async (idOrSlug: string) => (idOrSlug === GIF.id || idOrSlug === GIF.slug ? GIF : null)),
    ...overrides,
  };
}

describe('GET /api/gifs/:idOrSlug', () => {
  it('returns the gif when found by id', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get(`/api/gifs/${GIF.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: GIF });
    expect(repo.findGif).toHaveBeenCalledWith(GIF.id);
  });

  it('returns the gif when found by slug', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get(`/api/gifs/${GIF.slug}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: GIF });
    expect(repo.findGif).toHaveBeenCalledWith(GIF.slug);
  });

  it('returns 404 with an error message for an unknown gif', async () => {
    const repo = fakeRepository();
    const res = await request(buildApp(repo)).get('/api/gifs/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('does-not-exist');
  });

  it('propagates unexpected repository errors as a 500', async () => {
    const repo = fakeRepository({
      findGif: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const res = await request(buildApp(repo)).get('/api/gifs/anything');

    expect(res.status).toBe(500);
  });
});

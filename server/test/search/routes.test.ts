import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler';
import { createSearchRouter } from '../../src/routes/search';
import type { GifSearchQueryServiceLike, SearchGifsResult } from '../../src/search/searchService';
import type { GifSummary } from '../../src/services/categories';

const GIF: GifSummary = {
  id: '22222222-2222-2222-2222-222222222222',
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
};

function buildApp(service: GifSearchQueryServiceLike): Express {
  const app = express();
  app.use('/api/search', createSearchRouter(service));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function fakeService(overrides: Partial<GifSearchQueryServiceLike> = {}): GifSearchQueryServiceLike {
  const result: SearchGifsResult = { items: [GIF], total: 1, limit: 24, offset: 0 };
  return {
    search: vi.fn(async (params) => ({ ...result, limit: params.limit, offset: params.offset })),
    ...overrides,
  };
}

describe('GET /api/search', () => {
  it('returns ranked results with pagination metadata', async () => {
    const service = fakeService();
    const res = await request(buildApp(service)).get('/api/search?q=cat');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [GIF],
      pagination: { limit: 24, offset: 0, total: 1 },
    });
    expect(service.search).toHaveBeenCalledWith({ q: 'cat', category: undefined, limit: 24, offset: 0 });
  });

  it('trims whitespace around q', async () => {
    const service = fakeService();
    await request(buildApp(service)).get('/api/search?q=%20cat%20');

    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'cat' })
    );
  });

  it('passes an optional category filter through', async () => {
    const service = fakeService();
    await request(buildApp(service)).get('/api/search?q=cat&category=animals');

    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'cat', category: 'animals' })
    );
  });

  it('applies custom limit/offset', async () => {
    const service = fakeService();
    const res = await request(buildApp(service)).get('/api/search?q=cat&limit=10&offset=20');

    expect(res.status).toBe(200);
    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 })
    );
  });

  it('rejects a missing q with 400 and does not call the service', async () => {
    const service = fakeService();
    const res = await request(buildApp(service)).get('/api/search');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("'q'");
    expect(service.search).not.toHaveBeenCalled();
  });

  it('rejects a blank q with 400', async () => {
    const service = fakeService();
    const res = await request(buildApp(service)).get('/api/search?q=%20%20');

    expect(res.status).toBe(400);
    expect(service.search).not.toHaveBeenCalled();
  });

  it('rejects an invalid limit with 400', async () => {
    const service = fakeService();
    const res = await request(buildApp(service)).get('/api/search?q=cat&limit=0');

    expect(res.status).toBe(400);
    expect(service.search).not.toHaveBeenCalled();
  });

  it('propagates unexpected errors to the error handler as a 500 with a generic public message', async () => {
    // The error handler (L42-458) intentionally no longer echoes back the raw internal error
    // message for 5xx failures - only the generic message below reaches the client. The full
    // detail is still logged server-side by `errorHandler`.
    const service = fakeService({
      search: vi.fn(async () => {
        throw new Error('Elasticsearch is unreachable');
      }),
    });
    const res = await request(buildApp(service)).get('/api/search?q=cat');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  // L42-461: surfaces the Postgres-fallback signal from GifSearchQueryService.
  it('adds degraded:true and the X-Search-Degraded header when the service reports a degraded result', async () => {
    const service = fakeService({
      search: vi.fn(async (params) => ({
        items: [GIF],
        total: 1,
        limit: params.limit,
        offset: params.offset,
        degraded: true,
      })),
    });
    const res = await request(buildApp(service)).get('/api/search?q=cat');

    expect(res.status).toBe(200);
    expect(res.headers['x-search-degraded']).toBe('true');
    expect(res.body).toEqual({
      data: [GIF],
      pagination: { limit: 24, offset: 0, total: 1 },
      degraded: true,
    });
  });

  it('omits degraded and the header for a normal (non-degraded) result', async () => {
    const service = fakeService();
    const res = await request(buildApp(service)).get('/api/search?q=cat');

    expect(res.headers['x-search-degraded']).toBeUndefined();
    expect(res.body).not.toHaveProperty('degraded');
  });
});

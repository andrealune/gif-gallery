import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, getCategories, getCategory, getCategoryGifs, getGif, searchGifs } from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const category = {
  id: '1',
  name: 'Reactions',
  slug: 'reactions',
  description: null,
  gifCount: 3,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const gif = {
  id: 'g1',
  source: 'tenor',
  title: 'Clapping',
  description: null,
  categoryId: '1',
  url: 'https://example.com/g1.gif',
  thumbnailUrl: 'https://example.com/g1-thumb.gif',
  width: 200,
  height: 200,
  fileSizeBytes: 1000,
  durationMs: 2000,
  mimeType: 'image/gif',
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getCategories maps the { data, pagination } envelope into a Page', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: [category], pagination: { limit: 50, offset: 0, total: 1 } })
    );

    const page = await getCategories();

    expect(page).toEqual({ items: [category], limit: 50, offset: 0, total: 1 });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/categories?limit=50&offset=0'),
      expect.anything()
    );
  });

  it('getCategory returns null on a 404 instead of throwing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'Category not found: nope' }, 404));

    await expect(getCategory('nope')).resolves.toBeNull();
  });

  it('getCategory rethrows non-404 errors as ApiError with the server message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500));

    await expect(getCategory('reactions')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'boom',
    });
  });

  it('getCategory wraps network failures in an ApiError with status 0', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network down'));

    const err = await getCategory('reactions').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it('getCategoryGifs returns both the category and the gif page', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: [gif], category, pagination: { limit: 24, offset: 0, total: 1 } })
    );

    const result = await getCategoryGifs('reactions');

    expect(result).toEqual({
      category,
      gifs: { items: [gif], limit: 24, offset: 0, total: 1 },
    });
  });

  it('getCategoryGifs returns null when the category is not found', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404));

    await expect(getCategoryGifs('missing')).resolves.toBeNull();
  });

  it('searchGifs sends q/limit/offset and maps the envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ data: [gif], pagination: { limit: 24, offset: 0, total: 1 } })
    );

    const result = await searchGifs('clap', { limit: 24, offset: 0 });

    expect(result).toEqual({ items: [gif], limit: 24, offset: 0, total: 1 });
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toContain('/search?');
    expect(url).toContain('q=clap');
  });

  it('searchGifs surfaces a typed ApiError when the endpoint is unavailable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404));

    await expect(searchGifs('clap')).rejects.toBeInstanceOf(ApiError);
  });

  it('getGif fetches by id/slug and unwraps the envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ data: gif }));

    const result = await getGif('g1');

    expect(result).toEqual(gif);
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toContain('/gifs/g1');
  });

  it('getGif returns null when the gif is not found', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404));

    await expect(getGif('missing')).resolves.toBeNull();
  });

  it('getGif surfaces a typed ApiError for other failures (e.g. the route not existing yet)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'not implemented' }, 501));

    await expect(getGif('g1')).rejects.toBeInstanceOf(ApiError);
  });
});

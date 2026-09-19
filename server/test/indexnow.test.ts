import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';

describe('GET /:key.txt (IndexNow key verification)', () => {
  afterEach(() => {
    env.seo.indexNowKey = '';
  });

  it('404s when INDEXNOW_KEY is unset', async () => {
    env.seo.indexNowKey = '';
    const app = createApp();

    const res = await request(app).get('/some-key.txt');
    expect(res.status).toBe(404);
  });

  it('404s for any key that does not match INDEXNOW_KEY', async () => {
    env.seo.indexNowKey = 'abc123';
    const app = createApp();

    const res = await request(app).get('/not-the-key.txt');
    expect(res.status).toBe(404);
  });

  it('serves the key as plain text when the path matches INDEXNOW_KEY', async () => {
    env.seo.indexNowKey = 'abc123';
    const app = createApp();

    const res = await request(app).get('/abc123.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toBe('abc123');
  });

  it('does not shadow /robots.txt or /sitemap.xml', async () => {
    env.seo.indexNowKey = 'abc123';
    const app = createApp();

    const robots = await request(app).get('/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.text).toContain('User-agent: *');

    const sitemap = await request(app).get('/sitemap.xml');
    expect(sitemap.status).toBe(200);
  });
});

describe('submitUrlsToIndexNow', () => {
  afterEach(() => {
    env.seo.indexNowKey = '';
    vi.unstubAllGlobals();
  });

  it('skips (no network call) when INDEXNOW_KEY is unset', async () => {
    env.seo.indexNowKey = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { submitUrlsToIndexNow } = await import('../src/services/indexnow');
    const result = await submitUrlsToIndexNow(['http://localhost:3000/']);

    expect(result.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts same-host URLs to the IndexNow API and drops other hosts', async () => {
    env.seo.indexNowKey = 'abc123';
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const { submitUrlsToIndexNow } = await import('../src/services/indexnow');
    const result = await submitUrlsToIndexNow([
      'http://localhost:3000/',
      'http://localhost:3000/categories',
      'https://someone-elses-site.example/',
    ]);

    expect(result).toEqual({ skipped: false, status: 200, urlCount: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    const body = JSON.parse(options.body);
    expect(body.host).toBe('localhost:3000');
    expect(body.key).toBe('abc123');
    expect(body.keyLocation).toBe('http://localhost:3000/abc123.txt');
    expect(body.urlList).toEqual(['http://localhost:3000/', 'http://localhost:3000/categories']);
  });
});

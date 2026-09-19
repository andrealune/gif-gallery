import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { buildUrlsetXml, chunkEntries, MAX_URLS_PER_SITEMAP, type SitemapEntry } from '../src/services/sitemap';

const app = createApp();

describe('GET /sitemap.xml', () => {
  it('returns 200 with a well-formed urlset even without a database', async () => {
    const res = await request(app).get('/sitemap.xml');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(res.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  });

  it('includes the discovery pages as absolute URLs', async () => {
    const res = await request(app).get('/sitemap.xml');

    expect(res.text).toContain('<loc>http://localhost:3000/</loc>');
    expect(res.text).toContain('<loc>http://localhost:3000/categories</loc>');
    expect(res.text).toContain('<loc>http://localhost:3000/search</loc>');
  });

  it('degrades gracefully (no 500) when GIF/category tables are unavailable', async () => {
    // In this test environment there is no reachable Postgres instance, so
    // the dynamic gifs/categories queries are expected to fail internally.
    // The route must still respond 200 with the static entries rather than
    // propagating the DB error.
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
  });
});

describe('GET /sitemap-:index.xml', () => {
  it('returns 404 for an out-of-range chunk', async () => {
    const res = await request(app).get('/sitemap-99.xml');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-numeric chunk index', async () => {
    const res = await request(app).get('/sitemap-abc.xml');
    expect(res.status).toBe(404);
  });
});

describe('buildUrlsetXml', () => {
  it('escapes XML-significant characters in URLs', () => {
    const entries: SitemapEntry[] = [{ loc: 'http://localhost:3000/gif/a&b<c>"d\'e' }];
    const xml = buildUrlsetXml(entries);
    expect(xml).toContain('http://localhost:3000/gif/a&amp;b&lt;c&gt;&quot;d&apos;e');
    expect(xml).not.toContain('a&b<c>"d\'e');
  });

  it('renders lastmod, changefreq and priority when present', () => {
    const entries: SitemapEntry[] = [
      { loc: 'http://localhost:3000/', lastmod: '2024-01-01T00:00:00.000Z', changefreq: 'daily', priority: 1 },
    ];
    const xml = buildUrlsetXml(entries);
    expect(xml).toContain('<lastmod>2024-01-01T00:00:00.000Z</lastmod>');
    expect(xml).toContain('<changefreq>daily</changefreq>');
    expect(xml).toContain('<priority>1.0</priority>');
  });
});

describe('chunkEntries', () => {
  it('keeps small lists in a single chunk', () => {
    const entries: SitemapEntry[] = [{ loc: 'http://localhost:3000/' }];
    expect(chunkEntries(entries)).toEqual([entries]);
  });

  it('splits lists larger than MAX_URLS_PER_SITEMAP into multiple chunks', () => {
    const entries: SitemapEntry[] = Array.from({ length: MAX_URLS_PER_SITEMAP + 1 }, (_, i) => ({
      loc: `http://localhost:3000/gif/${i}`,
    }));
    const chunks = chunkEntries(entries);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(MAX_URLS_PER_SITEMAP);
    expect(chunks[1].length).toBe(1);
  });
});

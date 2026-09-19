import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

const app = createApp();

describe('GET /robots.txt', () => {
  it('returns 200 as plain text', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('allows crawling and points at the sitemap with an absolute URL', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.text).toContain('User-agent: *');
    expect(res.text).toContain('Allow: /');
    expect(res.text).toContain('Disallow: /api/');
    expect(res.text).toContain('Sitemap: http://localhost:3000/sitemap.xml');
  });
});

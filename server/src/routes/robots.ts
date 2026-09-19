import { Router } from 'express';
import { env } from '../config/env';

export const robotsRouter = Router();

/**
 * robots.txt: keep this in sync with what actually gets rendered/crawled.
 * - Allows crawling of the public site by default.
 * - Disallows the JSON API (not a page for users/crawlers to index).
 * - Points crawlers at the dynamic sitemap (L42-433) with an absolute URL,
 *   as required by the sitemaps.org / robots.txt convention.
 */
robotsRouter.get('/robots.txt', (_req, res) => {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${env.seo.siteUrl}/sitemap.xml`,
    '',
  ];

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(lines.join('\n'));
});

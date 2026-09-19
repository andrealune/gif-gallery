import { Router } from 'express';
import { buildSitemapIndexXml, buildUrlsetXml, chunkEntries, getAllSitemapEntries } from '../services/sitemap';
import { env } from '../config/env';

export const sitemapRouter = Router();

const XML_CONTENT_TYPE = 'application/xml; charset=utf-8';
// Sitemaps change as GIFs/categories are added; a short cache keeps us from
// hammering the DB on every crawler request without serving stale data for
// long after a change.
const CACHE_CONTROL = 'public, max-age=3600';

sitemapRouter.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const entries = await getAllSitemapEntries();
    const chunks = chunkEntries(entries);

    res.set('Content-Type', XML_CONTENT_TYPE);
    res.set('Cache-Control', CACHE_CONTROL);

    if (chunks.length <= 1) {
      res.send(buildUrlsetXml(chunks[0] ?? []));
      return;
    }

    const sitemapLocs = chunks.map((_, index) => `${env.seo.siteUrl}/sitemap-${index}.xml`);
    res.send(buildSitemapIndexXml(sitemapLocs));
  } catch (err) {
    next(err);
  }
});

// Only reached once the site has grown past MAX_URLS_PER_SITEMAP total
// URLs; /sitemap.xml then becomes a <sitemapindex> referencing these.
sitemapRouter.get('/sitemap-:index.xml', async (req, res, next) => {
  try {
    const index = Number.parseInt(req.params.index, 10);
    if (!Number.isInteger(index) || index < 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const entries = await getAllSitemapEntries();
    const chunks = chunkEntries(entries);
    const chunk = chunks[index];

    if (!chunk) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.set('Content-Type', XML_CONTENT_TYPE);
    res.set('Cache-Control', CACHE_CONTROL);
    res.send(buildUrlsetXml(chunk));
  } catch (err) {
    next(err);
  }
});

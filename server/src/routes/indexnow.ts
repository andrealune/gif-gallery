import { Router } from 'express';
import { env } from '../config/env';

export const indexNowRouter = Router();

/**
 * IndexNow key verification file (https://www.indexnow.org/documentation).
 * Bing/Yandex/Seznam only accept a submission for a key once they can fetch
 * `https://<site>/<key>.txt` and see that exact key as the whole body - this
 * is how they confirm we (not someone else) control the domain, without any
 * dashboard sign-in. Mounted at the root for the same reason as
 * robots.txt/sitemap.xml (L42-433): it has to be reachable from the site's
 * own origin, not the API's (see web/next.config.mjs's rewrite for those -
 * add `/:key.txt` there too once INDEXNOW_KEY is actually set in production).
 *
 * No-ops (404, via `next()`) when INDEXNOW_KEY is unset, and for any
 * `*.txt` request that isn't exactly that key - this route only ever serves
 * the one file it's meant to (L42-435).
 */
indexNowRouter.get('/:key.txt', (req, res, next) => {
  if (!env.seo.indexNowKey || req.params.key !== env.seo.indexNowKey) {
    next();
    return;
  }

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(env.seo.indexNowKey);
});

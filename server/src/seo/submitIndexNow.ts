import { env } from '../config/env';
import { getAllSitemapEntries } from '../services/sitemap';
import { submitUrlsToIndexNow } from '../services/indexnow';

/**
 * `npm run seo:submit-indexnow` (L42-435) - pushes every URL currently in
 * sitemap.xml to IndexNow (Bing/Yandex/Seznam) so they recrawl promptly
 * instead of on their own schedule. Safe to run repeatedly (e.g. from a
 * post-deploy step or a daily cron): IndexNow submissions are idempotent,
 * and this no-ops with a clear message when INDEXNOW_KEY isn't set yet.
 *
 * Run manually with: `npm run seo:submit-indexnow`
 */
async function main() {
  if (!env.seo.indexNowKey) {
    console.log(
      'INDEXNOW_KEY is not set - skipping. Get a key at https://www.bing.com/indexnow, ' +
        'set INDEXNOW_KEY, and make sure it is deployed before running this again.'
    );
    return;
  }

  const entries = await getAllSitemapEntries();
  const urls = entries.map((entry) => entry.loc);
  const result = await submitUrlsToIndexNow(urls);

  if (result.skipped) {
    console.log('Skipped: INDEXNOW_KEY is not set.');
    return;
  }

  console.log(`Submitted ${result.urlCount} URL(s) to IndexNow - response status ${result.status}.`);
  if (result.status && result.status >= 300) {
    console.warn(
      'A non-2xx status usually means the key file is not reachable yet at ' +
        `${env.seo.siteUrl}/${env.seo.indexNowKey}.txt - check that it deployed and is not being ` +
        'blocked/cached as 404, then retry.'
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('IndexNow submission failed:', err);
  process.exitCode = 1;
});

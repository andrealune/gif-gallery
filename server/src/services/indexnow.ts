import { env } from '../config/env';

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

export interface IndexNowResult {
  /** True if INDEXNOW_KEY isn't set - nothing was submitted, by design. */
  skipped: boolean;
  /** HTTP status IndexNow responded with (200 = accepted, 202 = queued). Absent when skipped. */
  status?: number;
  urlCount: number;
}

/**
 * Submits a batch of absolute URLs to the IndexNow API (single shared
 * endpoint that fans out to Bing, Yandex and Seznam - see
 * https://www.indexnow.org/documentation) so they get (re)crawled promptly
 * instead of waiting on the engines' own schedule. Part of L42-435
 * ("submit to search engines"): this is the one piece of that ticket that's
 * actually a machine-to-machine API rather than a human clicking through a
 * console.
 *
 * Requires INDEXNOW_KEY to be set (see src/config/env.ts) *and* the
 * corresponding `/<key>.txt` file to already be reachable at env.seo.siteUrl
 * (src/routes/indexnow.ts) - IndexNow verifies that before accepting a
 * submission. Every URL must be on `env.seo.siteUrl`'s host; others are
 * dropped rather than sent (IndexNow rejects a mixed-host batch outright).
 */
export async function submitUrlsToIndexNow(urls: string[]): Promise<IndexNowResult> {
  if (!env.seo.indexNowKey) {
    return { skipped: true, urlCount: 0 };
  }

  const host = new URL(env.seo.siteUrl).host;
  const sameHostUrls = urls.filter((url) => {
    try {
      return new URL(url).host === host;
    } catch {
      return false;
    }
  });

  const res = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key: env.seo.indexNowKey,
      keyLocation: `${env.seo.siteUrl}/${env.seo.indexNowKey}.txt`,
      urlList: sameHostUrls,
    }),
  });

  return { skipped: false, status: res.status, urlCount: sameHostUrls.length };
}

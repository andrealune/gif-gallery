/**
 * `NEXT_PUBLIC_API_BASE_URL` points at the Express API in `server/` (see server/src/app.ts,
 * mounted under `/api`). It's a `NEXT_PUBLIC_*` var on purpose: pages fetch it server-side for the
 * initial render, but client components (e.g. the search-as-you-type box landing in L42-428) call
 * it directly from the browser too, so it has to be available on both sides.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api'
).replace(/\/+$/, '');

/**
 * Canonical, public origin this app is served from - used to build absolute URLs for
 * `metadataBase`/Open Graph/Twitter tags (crawlers and link-unfurlers need absolute `og:url` and
 * `og:image` values, relative ones are ignored by most of them). Mirrors `SITE_URL` in
 * `server/src/config/env.ts` (already used there for `sitemap.xml`/`robots.txt`) so both halves of
 * the app agree on one origin - set the same value in both places when deploying.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
).replace(/\/+$/, '');

export const SITE_NAME = 'GIF Gallery';

export const SITE_DESCRIPTION =
  'Browse and search a growing collection of AI-generated and curated GIFs by category.';

export const DEFAULT_PAGE_SIZE = 24;

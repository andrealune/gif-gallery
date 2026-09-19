/**
 * `NEXT_PUBLIC_API_BASE_URL` points at the Express API in `server/` (see server/src/app.ts,
 * mounted under `/api`). It's a `NEXT_PUBLIC_*` var on purpose: pages fetch it server-side for the
 * initial render, but client components (e.g. the search-as-you-type box landing in L42-428) call
 * it directly from the browser too, so it has to be available on both sides.
 *
 * Because it is inlined into the client bundle it must always hold a **browser-reachable** origin.
 * Where the API is reachable under a different name from inside the network (split deployments,
 * preview environments - see `API_INTERNAL_BASE_URL` below and ADR 0001), use `resolveApiBaseUrl()`
 * rather than this constant for anything that may run on the server.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api'
).replace(/\/+$/, '');

/**
 * Optional container-to-container base URL for the API, used **only** by the Next.js server
 * (prerender during `next build`, server components, ISR revalidation) - L42-459, ADR 0001.
 *
 * In a preview/split deployment the browser reaches the API through a public hostname
 * (`${apps.server.url}`) that does not resolve from inside the `web` container, while the container
 * reaches it through an internal one (`${apps.server.internal}`). One variable cannot serve both
 * sides: an internal value would be baked into the client bundle and break the browser, a public
 * value breaks prerender/SSR (this is exactly the L42-456 failure). So the public URL stays in
 * `NEXT_PUBLIC_API_BASE_URL` and the internal one is supplied here.
 *
 * Deliberately **not** `NEXT_PUBLIC_*`: it must stay a server-side runtime lookup and never be
 * inlined into the client bundle. Unset (local development, and any deployment where a single URL
 * works from both sides) behaves exactly as before: everything uses `API_BASE_URL`.
 * Expected to include the `/api` prefix, like `NEXT_PUBLIC_API_BASE_URL`.
 */
export function resolveApiBaseUrl(): string {
  // Browser: always the public, inlined value - the internal host is not reachable (and not shipped).
  if (typeof window !== 'undefined') return API_BASE_URL;

  // Read lazily so the value is a runtime lookup on the server rather than a build-time constant.
  const internal = process.env.API_INTERNAL_BASE_URL?.trim();
  return internal ? internal.replace(/\/+$/, '') : API_BASE_URL;
}

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

/**
 * Baseline `<meta name="keywords">` terms every page includes (L42-434). Modern search engines
 * (Google, Bing) no longer rank on this tag, but it's still cheap, harmless, and explicitly asked
 * for by that ticket - so every page merges its own specific terms (category name, gif title, ...)
 * into this list via `buildKeywords` (see `lib/seo.ts`) rather than each page inventing its own
 * baseline from scratch.
 */
export const SITE_KEYWORDS = ['gif', 'gifs', 'animated gif', 'gif gallery', 'gif search', SITE_NAME.toLowerCase()];

export const DEFAULT_PAGE_SIZE = 24;

/**
 * Search-console ownership-verification codes (L42-435 - "submit to search engines"). Google
 * Search Console and Bing Webmaster Tools both offer an HTML-meta-tag verification method as an
 * alternative to a DNS TXT record; dropping the code they issue in here (via env var, once
 * someone actually registers the property) renders it into <head> - no code change needed at
 * that point. Both are empty/unset by default, which simply omits the tag (see
 * `metadata.verification` in `app/layout.tsx`) rather than shipping a bogus one.
 *
 * - Google: Search Console > Settings > Ownership verification > HTML tag > the `content` value.
 * - Bing: Bing Webmaster Tools > Settings > site verification. Bing also accepts a Google
 *   Search Console import, which avoids needing a separate code at all.
 */
export const GOOGLE_SITE_VERIFICATION = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ?? '';
export const BING_SITE_VERIFICATION = process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION ?? '';

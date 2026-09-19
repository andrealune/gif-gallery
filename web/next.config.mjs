/**
 * `/robots.txt` and `/sitemap.xml` are already fully implemented (with tests) on the API side -
 * see `server/src/routes/robots.ts` / `server/src/routes/sitemap.ts` (L42-433) - but that's the
 * wrong *origin*: crawlers fetch `https://<site>/robots.txt` and `https://<site>/sitemap.xml`
 * from the public site's own domain (`NEXT_PUBLIC_SITE_URL`/`SITE_URL`), not from the API's. When
 * `web` and `server` are deployed as separate services (as this repo is laid out - separate
 * `package.json`, separate default ports 3000/3001), those paths 404 on the site's own domain
 * today and are never seen by Google/Bing at all - the API's implementation never gets reached.
 *
 * Rather than duplicate the (DB-backed, already-tested) sitemap/robots logic in the Next.js app,
 * transparently proxy these three paths, at the Next.js server layer, to the API origin derived
 * from `NEXT_PUBLIC_API_BASE_URL`. The browser/crawler only ever sees the site's own origin; the
 * response body comes straight from the existing, tested route.
 */
function apiOrigin() {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
  return base.replace(/\/api\/?$/, '').replace(/\/+$/, '');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // GIF sources today: Tenor-hosted URLs (server/src/services/tenor) and, once L42-425 lands,
  // our own storage bucket/CDN. Remote hosts aren't finalized yet, so <GifCard> renders a plain
  // <img> instead of next/image (which requires each remote host to be allow-listed here). Revisit
  // once storage is settled - swapping to next/image then gets us automatic resizing/optimization.
  images: {
    remotePatterns: [],
  },
  async rewrites() {
    const origin = apiOrigin();
    return [
      { source: '/robots.txt', destination: `${origin}/robots.txt` },
      { source: '/sitemap.xml', destination: `${origin}/sitemap.xml` },
      // Chunked sitemaps (only reached past MAX_URLS_PER_SITEMAP total URLs - see
      // server/src/services/sitemap.ts), e.g. /sitemap-0.xml.
      { source: '/sitemap-:index.xml', destination: `${origin}/sitemap-:index.xml` },
    ];
  },
};

export default nextConfig;

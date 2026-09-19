import { env } from '../config/env';
import { query } from '../db/pool';

/**
 * Data access + XML building for sitemap.xml (and the Sitemap: directive in
 * robots.txt). See L42-433.
 *
 * Design notes:
 * - The GIF/category database schema is owned by L42-414 (database
 *   engineer) and had not landed yet when this was written. Rather than
 *   block on it, the dynamic queries below are written against the
 *   *expected* shape (a `gifs` table and a `categories` table, each with a
 *   URL-safe `slug` and an `updated_at` timestamp) and are wrapped so that
 *   any failure (table not migrated yet, column renamed, DB unreachable...)
 *   degrades gracefully to "no dynamic URLs" instead of a 500. That means
 *   this endpoint is safe to ship now: it serves the static/discovery pages
 *   today, and starts including GIF + category pages automatically as soon
 *   as the schema lands with matching column names, with a single warning
 *   logged if the names ever drift.
 * - If the actual schema differs, update GIFS_QUERY / CATEGORIES_QUERY below
 *   (and nowhere else - the route/XML code does not know about columns).
 */

export type ChangeFreq =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export interface SitemapEntry {
  /** Absolute URL. */
  loc: string;
  /** ISO 8601 date/datetime the page was last modified, if known. */
  lastmod?: string;
  changefreq?: ChangeFreq;
  /** 0.0 - 1.0 */
  priority?: number;
}

// Per the sitemaps.org protocol, a single sitemap file must contain no more
// than 50,000 URLs. We use a safety margin so we never bump into it exactly.
export const MAX_URLS_PER_SITEMAP = 45000;

/**
 * Discovery/marketing pages that exist regardless of GIF content: homepage,
 * category index, search, etc. Update this list as the frontend adds new
 * top-level, crawlable routes (e.g. a "trending" or "generate" page) -
 * nothing else in this file needs to change.
 */
function getStaticEntries(): SitemapEntry[] {
  const now = new Date().toISOString();
  return [
    { loc: absoluteUrl('/'), changefreq: 'daily', priority: 1.0, lastmod: now },
    { loc: absoluteUrl('/categories'), changefreq: 'daily', priority: 0.8, lastmod: now },
    { loc: absoluteUrl('/search'), changefreq: 'weekly', priority: 0.5, lastmod: now },
  ];
}

function absoluteUrl(pathname: string): string {
  return `${env.seo.siteUrl}${pathname}`;
}

let hasWarnedAboutGifs = false;
let hasWarnedAboutCategories = false;

// NOTE: expects a `gifs` table with a unique, URL-safe `slug` column and an
// `updated_at` timestamp (see coordination note posted on L42-414). Adjust
// here if the migrated schema names these differently.
const GIFS_QUERY = `SELECT slug, updated_at FROM gifs WHERE is_published = true ORDER BY updated_at DESC LIMIT $1`;

// NOTE: expects a `categories` table with a unique, URL-safe `slug` column
// and an `updated_at` timestamp.
const CATEGORIES_QUERY = `SELECT slug, updated_at FROM categories ORDER BY slug ASC LIMIT $1`;

async function getGifEntries(limit: number): Promise<SitemapEntry[]> {
  try {
    const result = await query<{ slug: string; updated_at: Date | string | null }>(GIFS_QUERY, [limit]);
    return result.rows.map((row) => ({
      loc: absoluteUrl(`/gif/${encodeURIComponent(row.slug)}`),
      lastmod: toIsoString(row.updated_at),
      changefreq: 'weekly' as const,
      priority: 0.7,
    }));
  } catch (err) {
    if (!hasWarnedAboutGifs) {
      hasWarnedAboutGifs = true;
      // eslint-disable-next-line no-console
      console.warn(
        'sitemap: could not load GIF entries (schema from L42-414 may not be migrated yet). ' +
          'Falling back to static pages only for /gif/* URLs.',
        err instanceof Error ? err.message : err
      );
    }
    return [];
  }
}

async function getCategoryEntries(limit: number): Promise<SitemapEntry[]> {
  try {
    const result = await query<{ slug: string; updated_at: Date | string | null }>(CATEGORIES_QUERY, [limit]);
    return result.rows.map((row) => ({
      loc: absoluteUrl(`/category/${encodeURIComponent(row.slug)}`),
      lastmod: toIsoString(row.updated_at),
      changefreq: 'daily' as const,
      priority: 0.8,
    }));
  } catch (err) {
    if (!hasWarnedAboutCategories) {
      hasWarnedAboutCategories = true;
      // eslint-disable-next-line no-console
      console.warn(
        'sitemap: could not load category entries (schema from L42-414 may not be migrated yet). ' +
          'Falling back to static pages only for /category/* URLs.',
        err instanceof Error ? err.message : err
      );
    }
    return [];
  }
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * All URLs that belong in the sitemap, static pages first. Capped well
 * above MAX_URLS_PER_SITEMAP per source so a single runaway table can't
 * blow up the response; overall chunking into multiple sitemap files (via a
 * sitemap index) happens in the route layer.
 */
export async function getAllSitemapEntries(): Promise<SitemapEntry[]> {
  const perSourceLimit = MAX_URLS_PER_SITEMAP * 2;
  const [gifEntries, categoryEntries] = await Promise.all([
    getGifEntries(perSourceLimit),
    getCategoryEntries(perSourceLimit),
  ]);

  const seen = new Set<string>();
  const entries: SitemapEntry[] = [];
  for (const entry of [...getStaticEntries(), ...categoryEntries, ...gifEntries]) {
    if (seen.has(entry.loc)) continue;
    seen.add(entry.loc);
    entries.push(entry);
  }
  return entries;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Renders a <urlset> sitemap XML document for the given entries. */
export function buildUrlsetXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
      if (entry.priority !== undefined) parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls}\n` +
    '</urlset>\n'
  );
}

/** Renders a <sitemapindex> XML document pointing at chunked sitemap files. */
export function buildSitemapIndexXml(sitemapLocs: string[]): string {
  const now = new Date().toISOString();
  const sitemaps = sitemapLocs
    .map((loc) => `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`)
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${sitemaps}\n` +
    '</sitemapindex>\n'
  );
}

/** Splits entries into <= MAX_URLS_PER_SITEMAP chunks, in stable order. */
export function chunkEntries(entries: SitemapEntry[]): SitemapEntry[][] {
  if (entries.length <= MAX_URLS_PER_SITEMAP) return [entries];
  const chunks: SitemapEntry[][] = [];
  for (let i = 0; i < entries.length; i += MAX_URLS_PER_SITEMAP) {
    chunks.push(entries.slice(i, i + MAX_URLS_PER_SITEMAP));
  }
  return chunks;
}

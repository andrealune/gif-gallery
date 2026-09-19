import { SITE_NAME } from './config';
import { absoluteUrl, categoryOgDescription, gifOgDescription, gifOgTitle } from './seo';
import type { GifDetail } from './api';
import type { CategorySummary, GifSummary } from './types';

/**
 * JSON-LD builders for search engines *and* LLM crawlers (Google's AI Overviews, ChatGPT/
 * Perplexity-style bots, ...) - see https://schema.org/ImageObject, /CreativeWork,
 * /CollectionPage and /BreadcrumbList. Kept as plain functions returning plain objects (rather
 * than JSX) so they're trivial to unit test without rendering React - `structuredData.test.ts`
 * covers them - and reuse the same title/description fallbacks the Open Graph tags in `seo.ts`
 * already use, so the two can't drift apart.
 *
 * Rendering happens via the `<JsonLd>` component (`components/seo/JsonLd.tsx`), which
 * `JSON.stringify`s and HTML-escapes whatever is returned here before it goes in a `<script>` tag.
 */

export type JsonLdObject = Record<string, any>;

function websiteRef(): JsonLdObject {
  return { '@type': 'WebSite', name: SITE_NAME, url: absoluteUrl('/') };
}

/** The `ImageObject` fields shared between a full GIF detail page and a list-item summary. */
function imageObjectFields(
  gif: Pick<GifSummary, 'title' | 'url' | 'thumbnailUrl' | 'width' | 'height' | 'mimeType'>
): JsonLdObject {
  return {
    name: gif.title || 'Untitled GIF',
    contentUrl: gif.url,
    ...(gif.thumbnailUrl ? { thumbnailUrl: gif.thumbnailUrl } : {}),
    ...(gif.width ? { width: gif.width } : {}),
    ...(gif.height ? { height: gif.height } : {}),
    encodingFormat: gif.mimeType || 'image/gif',
  };
}

/**
 * `/gif/:slug` detail page. Typed as both `ImageObject` and `CreativeWork` - an `ImageObject`
 * already *is* a `CreativeWork` in schema.org's hierarchy, but declaring both explicitly (a plain
 * JSON-LD array of types, valid per the spec) means a crawler that only recognises one of the two
 * vocab names still matches the page, per this issue's request for both.
 */
export function gifJsonLd(gif: GifDetail, pageUrl: string): JsonLdObject {
  const url = absoluteUrl(pageUrl);
  return {
    '@context': 'https://schema.org',
    '@type': ['ImageObject', 'CreativeWork'],
    '@id': url,
    url,
    name: gifOgTitle(gif),
    description: gifOgDescription(gif),
    ...imageObjectFields(gif),
    ...(gif.createdAt ? { uploadDate: gif.createdAt } : {}),
    ...(gif.updatedAt ? { dateModified: gif.updatedAt } : {}),
    isPartOf: websiteRef(),
  };
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

/** Mirrors whatever breadcrumb trail is actually rendered (`<nav aria-label="Breadcrumb">` on
 * both pages) - structured data has to match visible content per Google's guidelines. */
export function breadcrumbJsonLd(items: BreadcrumbItem[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/**
 * `/category/:slug` page: the category itself as a `CollectionPage`/`CreativeWork`, whose
 * `mainEntity` is the `ItemList` of GIFs currently rendered server-side for that page (the same
 * first page `GifCategoryBrowser` hydrates from - see `app/category/[slug]/page.tsx`), so the
 * markup never claims more items are on the page than actually are.
 */
export function categoryJsonLd(category: CategorySummary, gifs: GifSummary[], pageUrl: string): JsonLdObject {
  const url = absoluteUrl(pageUrl);
  return {
    '@context': 'https://schema.org',
    '@type': ['CollectionPage', 'CreativeWork'],
    '@id': url,
    url,
    name: category.name,
    description: categoryOgDescription(category),
    isPartOf: websiteRef(),
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: gifs.length,
      itemListElement: gifs.map((gif, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        // `GifSummary` has no `slug` yet (only `GifDetail` does - see the note on it in
        // `lib/api.ts`), so this falls back to `id`, same as every other id-only list surface.
        url: absoluteUrl(`/gif/${gif.id}`),
        item: { '@type': 'ImageObject', ...imageObjectFields(gif) },
      })),
    },
  };
}

/**
 * Serializes a JSON-LD payload for embedding in a `<script type="application/ld+json">` via
 * `dangerouslySetInnerHTML`. Escapes `<`/`>` and the JS line-separator characters so no field
 * sourced from the API (a GIF/category title or description) can close the `<script>` tag early
 * or smuggle markup into the page - the standard mitigation for JSON embedded in HTML.
 */
export function serializeJsonLd(data: JsonLdObject | JsonLdObject[]): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

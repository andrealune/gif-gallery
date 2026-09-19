import { SITE_NAME, SITE_URL } from './config';
import type { GifDetail } from './api';

/**
 * Resolves `path` (e.g. `/gif/clapping-cat`) to an absolute URL under `SITE_URL`. Open Graph and
 * Twitter Card consumers (Slack, Facebook, X/Twitter, iMessage, ...) resolve `og:url`/`og:image`
 * against the *document* origin only when they even bother to - most just ignore relative values -
 * so every shareable meta tag needs an absolute URL.
 */
export function absoluteUrl(path: string): string {
  return new URL(path, `${SITE_URL}/`).toString();
}

/**
 * Meta descriptions longer than ~160 characters get truncated (with a "..." link-preview cards
 * look worse) by most search engines and unfurlers, so trim at a word boundary before that limit
 * rather than mid-word.
 */
export function truncate(text: string, maxLength = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Falls back to a generic-but-still-descriptive line when a GIF has no `description` set. */
export function gifOgDescription(gif: GifDetail): string {
  const title = gif.title || 'This GIF';
  const base = gif.description?.trim() || `${title} - watch, share and download it on ${SITE_NAME}.`;
  return truncate(base);
}

export function gifOgTitle(gif: GifDetail): string {
  return gif.title || 'Untitled GIF';
}

/**
 * The `og:image`/`twitter:image` for a single GIF page: prefer the (usually lighter/static)
 * thumbnail so link previews load fast, falling back to the full GIF when no thumbnail exists.
 * Both are already absolute (Tenor-hosted today, our own CDN once L42-425 lands - see
 * `next.config.mjs`), so no `absoluteUrl()` call is needed here.
 */
export function gifOgImage(gif: GifDetail): { url: string; width?: number; height?: number; alt: string } | null {
  const url = gif.thumbnailUrl ?? gif.url;
  if (!url) return null;
  return {
    url,
    ...(gif.width ? { width: gif.width } : {}),
    ...(gif.height ? { height: gif.height } : {}),
    alt: gifOgTitle(gif),
  };
}

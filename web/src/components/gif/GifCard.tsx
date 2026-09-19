import Link from 'next/link';
import type { GifSummary } from '@/lib/types';

function formatDuration(ms: number | null): string | null {
  if (!ms) return null;
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

/**
 * A single GIF preview: thumbnail + title + light metadata (source, duration). Deliberately a
 * plain `<img>` rather than `next/image` - see the comment in `next.config.mjs` for why - with
 * `loading="lazy"` so off-screen cards don't cost anything until scrolled into view.
 *
 * The whole card links to the gif's detail page (`/gif/[slug]`, L42-429) - by `slug` when the
 * caller already has one (the detail page's own "related gifs" section, which fetches
 * `GifDetail`s), falling back to `id` everywhere else (category/search results only ever get a
 * plain `GifSummary`, which has no `slug`). The backend's `idOrSlug` lookup (see `getGif` in
 * `lib/api.ts`) accepts either, so this never has to know which one it has.
 */
export function GifCard({ gif }: { gif: GifSummary & { slug?: string } }) {
  const src = gif.thumbnailUrl ?? gif.url;
  const duration = formatDuration(gif.durationMs);
  const title = gif.title || 'Untitled GIF';

  return (
    <Link
      href={`/gif/${gif.slug ?? gif.id}`}
      className="group block overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote hosts aren't finalized, see next.config.mjs */}
        <img
          src={src}
          alt={title}
          loading="lazy"
          decoding="async"
          width={gif.width ?? undefined}
          height={gif.height ?? undefined}
          className="h-full w-full object-cover transition group-hover:scale-105"
        />
        {duration ? (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
            {duration}
          </span>
        ) : null}
      </div>
      <div className="p-3">
        <h3 className="truncate text-sm font-medium text-slate-900 group-hover:text-brand-700" title={gif.title}>
          {title}
        </h3>
        <p className="mt-0.5 text-xs uppercase tracking-wide text-slate-400">{gif.source}</p>
      </div>
    </Link>
  );
}

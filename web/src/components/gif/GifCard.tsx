import Link from 'next/link';
import type { CategorySummary, GifSummary } from '@/lib/types';

function formatDuration(ms: number | null): string | null {
  if (!ms) return null;
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

/**
 * A single GIF preview: thumbnail + title, linking to the gif's detail page (`/gif/[slug]`,
 * L42-429) - by `slug` when the caller already has one (the detail page's own "related gifs"
 * section), falling back to `id` everywhere else (category/search results only ever get a plain
 * `GifSummary`, which has no `slug`). The backend's `idOrSlug` lookup (see `getGif` in
 * `lib/api.ts`) accepts either, so this never has to know which one it has.
 *
 * Below that sits light metadata: source, a duration badge, and optionally category - see below.
 * The metadata row is deliberately a sibling of the detail-page link, not nested inside it: an
 * `<a>` inside another `<a>` is invalid HTML, and would make clicking the category link also
 * fire the outer navigation. Deliberately a plain `<img>` rather than `next/image` - see the
 * comment in `next.config.mjs` for why - with `loading="lazy"` so off-screen cards don't cost
 * anything until scrolled into view.
 */
export function GifCard({
  gif,
  category = null,
}: {
  gif: GifSummary & { slug?: string };
  /**
   * The gif's category, when the caller already has (or can cheaply look up) it. `GifSummary`
   * itself only carries `categoryId` (see `lib/types.ts`), not a name/slug to render - callers
   * scoped to a single category already (the category page, a category's gif rail) have no
   * reason to pass this. The search results grid (L42-428) spans every category, so it looks
   * `categoryId` up against `/api/categories` and passes the match here - see `GifGrid`'s
   * `categories` prop. Omitted (or not found), the card renders exactly as it did before this
   * prop existed.
   */
  category?: Pick<CategorySummary, 'name' | 'slug'> | null;
}) {
  const src = gif.thumbnailUrl ?? gif.url;
  const duration = formatDuration(gif.durationMs);
  const title = gif.title || 'Untitled GIF';

  return (
    <article className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <Link
        href={`/gif/${gif.slug ?? gif.id}`}
        className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
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
        <div className="px-3 pt-3">
          <h3 className="truncate text-sm font-medium text-slate-900 group-hover:text-brand-700" title={gif.title}>
            {title}
          </h3>
        </div>
      </Link>
      <p className="flex flex-wrap items-center gap-1 truncate px-3 pb-3 pt-0.5 text-xs uppercase tracking-wide text-slate-400">
        <span>{gif.source}</span>
        {category ? (
          <>
            <span aria-hidden="true">·</span>
            <Link
              href={`/category/${category.slug}`}
              className="truncate text-slate-500 hover:text-brand-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              {category.name}
            </Link>
          </>
        ) : null}
      </p>
    </article>
  );
}

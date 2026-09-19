'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getCategoryGifs } from '@/lib/api';
import type { GifSummary, Page } from '@/lib/types';
import { GifGrid } from './GifGrid';
import { GifCardSkeleton, GridSkeleton } from '@/components/ui/Skeleton';

interface GifCategoryBrowserProps {
  categorySlug: string;
  /** First page, already fetched on the server so the grid has content before hydration. */
  initialGifs: Page<GifSummary>;
}

/**
 * Renders a category's first page of gifs (rendered by the server, see
 * `app/category/[slug]/page.tsx`) and lazily fetches the rest as the user scrolls: an
 * `IntersectionObserver` on the sentinel below the grid triggers the next page, which is appended
 * in place. The same sentinel doubles as a "Load more" button, so this works without
 * `IntersectionObserver` support and is fully keyboard/screen-reader operable - focusing or
 * activating the button loads the next page exactly like scrolling it into view does.
 *
 * With JavaScript disabled this component never mounts; the page renders real `Pagination` links
 * inside a `<noscript>` immediately after it so browsing every gif in a category still works, just
 * a page at a time instead of continuously.
 */
export function GifCategoryBrowser({ categorySlug, initialGifs }: GifCategoryBrowserProps) {
  const [items, setItems] = useState(initialGifs.items);
  const [offset, setOffset] = useState(initialGifs.offset);
  const [total, setTotal] = useState(initialGifs.total);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = initialGifs.limit;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  const hasMore = offset + items.length < total;

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const nextOffset = offset + items.length;
      const result = await getCategoryGifs(categorySlug, { limit, offset: nextOffset });
      if (result) {
        setItems((prev) => [...prev, ...result.gifs.items]);
        setTotal(result.gifs.total);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more gifs. Please try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [categorySlug, items.length, limit, offset]);

  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === 'undefined') return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div>
      <GifGrid gifs={items} />

      {/* Announced to screen readers as new pages land; visually redundant with the grid itself. */}
      <p aria-live="polite" className="sr-only">
        {loading ? 'Loading more gifs…' : `Showing ${items.length} of ${total} gifs.`}
      </p>

      {loading ? (
        <div className="mt-6">
          <GridSkeleton count={Math.min(limit, 10)} Item={GifCardSkeleton} />
        </div>
      ) : null}

      {error ? (
        <div className="mt-8 flex flex-col items-center gap-3">
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            Try again
          </button>
        </div>
      ) : hasMore ? (
        <div ref={sentinelRef} className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            aria-busy={loading}
            className="rounded-full bg-brand-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {loading ? 'Loading…' : 'Load more gifs'}
          </button>
        </div>
      ) : items.length > limit ? (
        <p className="mt-8 text-center text-sm text-slate-400">You&rsquo;ve reached the end - {total} gifs total.</p>
      ) : null}
    </div>
  );
}

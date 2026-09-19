'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CategorySummary } from '@/lib/types';

/**
 * L42-450: renders the category's real thumbnail when the backend provides one, falling back to
 * the original emoji-on-gradient placeholder when there is none or the image fails to load. The
 * loading-state skeleton for this same box is handled separately by <CategoryCardSkeleton>
 * (components/ui/Skeleton.tsx), rendered by app/loading.tsx while the category list itself is
 * still being fetched - this component only ever renders once category data is available.
 */
export function CategoryCard({ category }: { category: CategorySummary }) {
  // Tracks a failed image load (broken URL, 404, decode error, ...).
  const [imageFailed, setImageFailed] = useState(false);

  // `Boolean(...)` rather than `!== null` so a response that omits the field entirely
  // (`undefined`, e.g. before the backend rollout in L42-449 reaches this environment) falls
  // back to the placeholder exactly like an explicit `null`, instead of rendering a broken image.
  const hasThumbnail = Boolean(category.thumbnailUrl) && !imageFailed;

  return (
    <Link
      href={`/category/${category.slug}`}
      className="group block overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      {hasThumbnail ? (
        // Remote hosts aren't finalized yet, see next.config.mjs (same rationale as GifCard,
        // whose live-thumbnail-with-no-gating precedent this mirrors - see L42-451).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={category.thumbnailUrl as string}
          // Decorative: the card's accessible name comes from the visible category name text
          // below, not from this image.
          alt=""
          loading="lazy"
          className="aspect-[4/3] w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        // Documented empty state (no thumbnail available, or the image failed to load) -
        // unchanged, do not remove.
        <div
          aria-hidden="true"
          className="flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br from-brand-100 to-brand-300 text-4xl"
        >
          🎬
        </div>
      )}
      <div className="p-4">
        <h3 className="font-semibold text-slate-900 group-hover:text-brand-700">{category.name}</h3>
        {category.description ? (
          <p className="mt-1 line-clamp-2 text-sm text-slate-500">{category.description}</p>
        ) : null}
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          {category.gifCount} {category.gifCount === 1 ? 'gif' : 'gifs'}
        </p>
      </div>
    </Link>
  );
}

import type { Metadata } from 'next';
import { ApiError, getCategories, searchGifs } from '@/lib/api';
import { Container } from '@/components/layout/Container';
import { GifGrid } from '@/components/gif/GifGrid';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SearchForm } from '@/components/search/SearchForm';
import { DEFAULT_PAGE_SIZE } from '@/lib/config';
import { buildKeywords, truncate } from '@/lib/seo';
import type { CategorySummary } from '@/lib/types';

interface SearchPageProps {
  searchParams: Promise<{ q?: string; offset?: string }>;
}

function parseOffset(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '0', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const { q } = await searchParams;
  const query = q?.trim();

  return {
    title: query ? `Search results for "${query}"` : 'Search',
    description: query
      ? truncate(`GIF search results for "${query}".`)
      : 'Search the gallery for GIFs by keyword.',
    keywords: buildKeywords(query, 'gif search', 'search gifs'),
    // Query-string search-result pages are unbounded (one per possible query), near-duplicates of
    // each other, and not something we want ranked directly - `/search` itself (no query) stays
    // indexable as the entry point. This is a `noindex`, not a `nofollow`: crawlers should still
    // follow links from a results page to the GIF/category pages it lists.
    robots: query ? { index: false, follow: true } : undefined,
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, offset } = await searchParams;
  const query = (q ?? '').trim();
  const safeOffset = parseOffset(offset);

  let results: Awaited<ReturnType<typeof searchGifs>> | null = null;
  let error: string | null = null;
  let unavailable = false;

  // Kicked off alongside the search request below (not awaited yet) so both round-trip in
  // parallel: search results only carry `categoryId` (see `lib/types.ts#GifSummary`), so this is
  // how the grid gets a name/slug to label each result with - see `GifGrid`'s `categories` prop.
  // Best-effort: results still render, just without a category label, if this fails.
  const categoriesPromise = query ? getCategories({ limit: 100 }).catch(() => null) : Promise.resolve(null);

  if (query) {
    try {
      results = await searchGifs(query, { limit: DEFAULT_PAGE_SIZE, offset: safeOffset });
    } catch (err) {
      // `/api/search` (L42-420) can still be unreachable in some environments (not deployed yet,
      // Elasticsearch down, ...) - treat "not found"/"not implemented"/offline as "not available
      // right now" rather than a hard failure, so this page degrades gracefully instead of
      // showing a raw error for something the user can't fix.
      if (err instanceof ApiError && (err.status === 404 || err.status === 501 || err.status === 0)) {
        unavailable = true;
      } else {
        error = err instanceof ApiError ? err.message : 'Unexpected error while searching.';
      }
    }
  }

  const categoriesPage = await categoriesPromise;
  const categoriesById: Map<string, CategorySummary> = categoriesPage
    ? new Map(categoriesPage.items.map((category) => [category.id, category]))
    : new Map();

  return (
    <Container className="py-10">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Search GIFs</h1>

      <div className="mt-4 max-w-xl">
        <SearchForm defaultValue={query} size="lg" />
      </div>

      <div className="mt-8">
        {/*
         * L42-461/L42-464: `results.degraded` is `true` when `/api/search` used its Postgres
         * full-text fallback instead of Elasticsearch - always the case in preview per ADR 0001
         * (docs/adr/0001-preview-environment-topology.md), and also whenever the cluster is
         * otherwise unreachable. Shown regardless of result count (even for zero results) so a
         * reviewer never mistakes "basic search" ranking for an actual relevance regression.
         */}
        {results?.degraded ? (
          <p
            role="status"
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
          >
            <span className="rounded-full bg-amber-200 px-2 py-0.5 uppercase tracking-wide">
              Basic search
            </span>
            <span className="font-normal text-amber-700">
              Full relevance ranking is temporarily unavailable - showing keyword matches instead.
            </span>
          </p>
        ) : null}

        {!query ? (
          <EmptyState
            title="Search for something"
            description='Try a word like "celebration" or "cat".'
          />
        ) : unavailable ? (
          <EmptyState
            title="Search is coming soon"
            description="The search API isn't live yet - this page is ready to show results as soon as it is."
          />
        ) : error ? (
          <ErrorState description={error} />
        ) : results && results.items.length > 0 ? (
          <>
            <p className="text-sm text-slate-500">
              {results.total} {results.total === 1 ? 'result' : 'results'} for &ldquo;{query}&rdquo;
            </p>
            <div className="mt-4">
              <GifGrid gifs={results.items} categories={categoriesById} />
            </div>
            <Pagination
              basePath="/search"
              query={{ q: query }}
              limit={results.limit}
              offset={results.offset}
              total={results.total}
            />
          </>
        ) : (
          <EmptyState
            title={`No results for "${query}"`}
            description="Try a different search term."
          />
        )}
      </div>
    </Container>
  );
}

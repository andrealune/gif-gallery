import type { Metadata } from 'next';
import { ApiError, searchGifs } from '@/lib/api';
import { Container } from '@/components/layout/Container';
import { GifGrid } from '@/components/gif/GifGrid';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SearchForm } from '@/components/search/SearchForm';
import { DEFAULT_PAGE_SIZE } from '@/lib/config';

interface SearchPageProps {
  searchParams: Promise<{ q?: string; offset?: string }>;
}

function parseOffset(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '0', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `Search results for "${q}"` : 'Search',
    // Query-string search-result pages are unbounded (one per possible query), near-duplicates of
    // each other, and not something we want ranked directly - `/search` itself (no query) stays
    // indexable as the entry point. This is a `noindex`, not a `nofollow`: crawlers should still
    // follow links from a results page to the GIF/category pages it lists.
    robots: q ? { index: false, follow: true } : undefined,
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q, offset } = await searchParams;
  const query = (q ?? '').trim();
  const safeOffset = parseOffset(offset);

  let results: Awaited<ReturnType<typeof searchGifs>> | null = null;
  let error: string | null = null;
  let unavailable = false;

  if (query) {
    try {
      results = await searchGifs(query, { limit: DEFAULT_PAGE_SIZE, offset: safeOffset });
    } catch (err) {
      // The `/api/search` endpoint doesn't exist yet (see lib/api.ts) - treat "not found"/"not
      // implemented" as "not available yet" rather than a hard failure, so this page already
      // degrades gracefully and needs no changes once the backend route ships (L42-428).
      if (err instanceof ApiError && (err.status === 404 || err.status === 501 || err.status === 0)) {
        unavailable = true;
      } else {
        error = err instanceof ApiError ? err.message : 'Unexpected error while searching.';
      }
    }
  }

  return (
    <Container className="py-10">
      <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Search GIFs</h1>

      <div className="mt-4 max-w-xl">
        <SearchForm defaultValue={query} size="lg" />
      </div>

      <div className="mt-8">
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
              <GifGrid gifs={results.items} />
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

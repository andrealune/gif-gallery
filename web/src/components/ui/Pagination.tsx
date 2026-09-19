import Link from 'next/link';

interface PaginationProps {
  /** Path the prev/next links point at, e.g. `/search` or `/category/reactions`. */
  basePath: string;
  /** Other query params to preserve across pages, e.g. `{ q: 'cats' }`. */
  query?: Record<string, string | undefined>;
  limit: number;
  offset: number;
  total: number;
}

function hrefFor(basePath: string, query: Record<string, string | undefined>, offset: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  if (offset > 0) params.set('offset', String(offset));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Prev/next pager shared by every paginated list (category gifs, search results, ...). */
export function Pagination({ basePath, query = {}, limit, offset, total }: PaginationProps) {
  if (total <= limit && offset === 0) return null;

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;

  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-between gap-4">
      {hasPrev ? (
        <Link
          href={hrefFor(basePath, query, prevOffset)}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          ← Previous
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400"
        >
          ← Previous
        </span>
      )}

      <p className="text-sm text-slate-500">
        Page {currentPage} of {totalPages}
      </p>

      {hasNext ? (
        <Link
          href={hrefFor(basePath, query, nextOffset)}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Next →
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400"
        >
          Next →
        </span>
      )}
    </nav>
  );
}

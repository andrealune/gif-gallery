import { API_BASE_URL, DEFAULT_PAGE_SIZE } from './config';
import type { CategorySummary, GifSummary, Page, PaginationParams } from './types';

/**
 * Thrown for any non-2xx (or unreachable) API response. `status` is 0 when the request never
 * reached the server (offline, DNS failure, etc.) so callers can tell "API said no" apart from
 * "API is down" if they want to.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const isNotFound = (err: unknown): boolean => err instanceof ApiError && err.status === 404;

interface ListEnvelope<T> {
  data: T[];
  pagination: { limit: number; offset: number; total: number };
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function toPage<T>(envelope: ListEnvelope<T>): Page<T> {
  return {
    items: envelope.data,
    limit: envelope.pagination.limit,
    offset: envelope.pagination.offset,
    total: envelope.pagination.total,
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  let res: Response;

  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(`Could not reach the gallery API (${url}). Is the server running?`, 0);
  }

  if (!res.ok) {
    let message = `Request to ${path} failed with status ${res.status}`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        message = body.error;
      }
    } catch {
      // Response body wasn't JSON (or was empty) - fall back to the generic message above.
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}

/** `GET /api/categories` - every category with its live gif count. */
export async function getCategories(params: PaginationParams = {}): Promise<Page<CategorySummary>> {
  const query = buildQuery({ limit: params.limit ?? 50, offset: params.offset ?? 0 });
  const envelope = await apiFetch<ListEnvelope<CategorySummary>>(`/categories${query}`, {
    next: { revalidate: 60 },
  });
  return toPage(envelope);
}

/** `GET /api/categories/:idOrSlug`. Returns `null` (instead of throwing) when it's a 404. */
export async function getCategory(idOrSlug: string): Promise<CategorySummary | null> {
  try {
    const { data } = await apiFetch<{ data: CategorySummary }>(
      `/categories/${encodeURIComponent(idOrSlug)}`,
      { next: { revalidate: 60 } }
    );
    return data;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** `GET /api/categories/:idOrSlug/gifs` - the category plus one page of its gifs. */
export async function getCategoryGifs(
  idOrSlug: string,
  params: PaginationParams = {}
): Promise<{ category: CategorySummary; gifs: Page<GifSummary> } | null> {
  const query = buildQuery({ limit: params.limit ?? DEFAULT_PAGE_SIZE, offset: params.offset ?? 0 });

  try {
    const envelope = await apiFetch<ListEnvelope<GifSummary> & { category: CategorySummary }>(
      `/categories/${encodeURIComponent(idOrSlug)}/gifs${query}`,
      { next: { revalidate: 30 } }
    );
    return { category: envelope.category, gifs: toPage(envelope) };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * `GET /api/search?q=&limit=&offset=` (backend: `server/src/routes/search.ts`, L42-420) - ranked
 * full-text search over the `gifs` index, hydrated to the same `GifSummary` shape every other
 * list endpoint returns. Speaks the same `{ data, pagination }` / `limit`+`offset` envelope, so
 * the search results page (L42-428) needed no changes once the route shipped.
 */
export async function searchGifs(q: string, params: PaginationParams = {}): Promise<Page<GifSummary>> {
  const query = buildQuery({
    q,
    limit: params.limit ?? DEFAULT_PAGE_SIZE,
    offset: params.offset ?? 0,
  });
  const envelope = await apiFetch<ListEnvelope<GifSummary>>(`/search${query}`, { cache: 'no-store' });
  return toPage(envelope);
}

/**
 * A single GIF with the extra field(s) only the detail page needs.
 *
 * `slug` mirrors `server/src/services/gifs/types.ts#GifDetail` (backend, L42-448) - the gif's
 * slugified title, used to build the pretty `/gif/:slug` URL. Optional here only because it isn't
 * (and never has been) part of `GifSummary`/the list endpoints, so every existing list/grid caller
 * (which never gets a `slug` from `/categories/:id/gifs` or `/search`) is unaffected.
 *
 * `tags` is speculative: `server/migrations/0006_create_gif_tags_table.up.sql` created a
 * `gif_tags` table, but `GET /api/gifs/:idOrSlug` doesn't join it yet, so this endpoint never
 * actually sends a `tags` array today - see the propose_work filed from L42-429 for wiring it up
 * backend-side. Kept optional (rather than omitted) so the detail page's tags section is ready to
 * render real data the moment the backend adds it, with zero frontend changes needed.
 */
export interface GifDetail extends GifSummary {
  slug?: string;
  tags?: string[];
}

/**
 * `GET /api/gifs/:idOrSlug` (backend: `server/src/routes/gifs.ts`, L42-448) - single gif lookup by
 * UUID or slug, mirroring the `idOrSlug` lookup convention `getCategory` already uses. Returns
 * `null` (rather than throwing) on a 404 so the `/gif/[slug]` page (L42-429/L42-431) can call
 * `notFound()`. This throws for any other failure (offline, 5xx, ...); the page treats that as a
 * hard error like every other page here does.
 */
export async function getGif(idOrSlug: string): Promise<GifDetail | null> {
  try {
    const { data } = await apiFetch<{ data: GifDetail }>(`/gifs/${encodeURIComponent(idOrSlug)}`, {
      next: { revalidate: 60 },
    });
    return data;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

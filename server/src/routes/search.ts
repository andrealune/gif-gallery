import { Router } from 'express';
import { HttpError } from '../middleware/errorHandler';
import { createGifSearchQueryService } from '../search/backend';
import type { GifSearchQueryServiceLike } from '../search/searchService';
import { parsePagination } from '../utils/pagination';

/**
 * `GET /api/search?q=&category=&limit=&offset=` (L42-420): full-text search
 * over the `gifs` catalog, ranked by relevance, with optional category
 * filtering and the same `{ data, pagination }` / `limit`+`offset` envelope
 * every other list endpoint uses (see `routes/categories.ts`) -
 * `web/src/lib/api.ts#searchGifs` already speaks this exact contract.
 *
 * `service` defaults to whichever backend `search/backend.ts#createGifSearchQueryService` selects
 * (Elasticsearch-backed `GifSearchQueryService`, or the Postgres-backed `PostgresGifSearchQueryService`
 * fallback used wholesale when Elasticsearch isn't configured/reachable at startup - `SEARCH_BACKEND`,
 * L42-463) but can be swapped for a fake in tests - see `test/search/routes.test.ts` and
 * `test/search/routes.postgresBackend.test.ts`.
 *
 * L42-461: when the resolved `GifSearchQueryService` itself has to fall back to Postgres full-text
 * search per request (Elasticsearch enabled but unreachable at query time - see
 * `search/searchService.ts`), the response gets an extra `degraded: true` field alongside
 * `data`/`pagination`, plus an `X-Search-Degraded: true` header for callers that would rather not
 * parse the body, so the client can show a "basic search" notice. Omitted entirely otherwise, so this
 * is additive - an existing caller that only reads `data`/`pagination` sees no change.
 */
export function createSearchRouter(service: GifSearchQueryServiceLike = createGifSearchQueryService()): Router {
  const router = Router();

  // GET /api/search?q=&category=&limit=&offset=
  router.get('/', async (req, res, next) => {
    try {
      const q = parseQuery(req.query.q);
      const category = parseCategory(req.query.category);
      const { limit, offset } = parsePagination(req.query, { defaultLimit: 24, maxLimit: 100 });

      const result = await service.search({ q, category, limit, offset });

      if (result.degraded) {
        res.setHeader('X-Search-Degraded', 'true');
      }

      res.json({
        data: result.items,
        pagination: { limit: result.limit, offset: result.offset, total: result.total },
        ...(result.degraded ? { degraded: true } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** `q` is required and must be non-blank - an empty search isn't a meaningful query, unlike `category`/pagination. */
function parseQuery(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, "Query parameter 'q' is required");
  }
  return value.trim();
}

/** `category` (an id or slug, see `search/searchQuery.ts`) is optional - undefined means "every category". */
function parseCategory(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, "Query parameter 'category' must be a string");
  }
  return value.trim();
}

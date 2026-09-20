/**
 * Postgres full-text fallback for `GET /api/search` (L42-461).
 *
 * `GifSearchQueryService` prefers Elasticsearch, but that cluster is
 * deliberately absent from preview environments (ADR 0001 -
 * `docs/adr/0001-preview-environment-topology.md`: no extra container,
 * `ELASTICSEARCH_SYNC_ENABLED=false`) and can legitimately be unreachable in
 * production too (restart, network blip, ...). Without this fallback every
 * one of those cases 500s the *only* route with a hard Elasticsearch
 * dependency, so search - a headline feature - is unreviewable on PRs and
 * fragile in production.
 *
 * This is used two ways (see `searchService.ts`):
 *   - `ELASTICSEARCH_ENABLED=false` (e.g. every preview): used unconditionally,
 *     no attempt to reach a cluster that was never started.
 *   - Elasticsearch is enabled but a query against it throws (unreachable,
 *     timed out, ...): used per-request as a catch-all, so production
 *     degrades gracefully instead of 500ing.
 *
 * Ranking/relevance: `gifs.search_vector` (see
 * `migrations/0005_create_gifs_table.up.sql`) is a generated, GIN-indexed
 * tsvector over `title` (weight A) and `description` (weight B), so
 * `ts_rank_cd` gives the same "title matters more" ordering
 * `searchQuery.ts`'s `title^3` boost gives the Elasticsearch path - without
 * a second round trip, unlike the ES path this hydrates nothing separately.
 * A gif whose tags (not part of `search_vector`) match `q` but whose
 * title/description don't is still included (`EXISTS` over `gif_tags`/
 * `tags`, mirroring the Elasticsearch request's `tags.text` field) but,
 * lacking a text match to rank against, sorts after every `search_vector`
 * hit, by `updated_at` (same tiebreaker `searchQuery.ts` uses after `_score`).
 *
 * This is intentionally simpler than the Elasticsearch path: no fuzzy
 * matching (typo tolerance), no cross-field `best_fields` scoring. That
 * gap is the point of the `degraded: true` flag `searchService.ts` attaches
 * to whatever this returns - "basic search", not a silent drop-in
 * replacement. See the issue for the alternative (an opt-in `elasticsearch`
 * preview service) if product instead wants full parity in previews.
 */
import type { Pool, QueryResultRow } from 'pg';
import { pool } from '../db/pool';
import type { GifSummary } from '../services/categories';
import type { GifSearchQueryParams } from './searchQuery';
import type { GifSearchFallbackLike, SearchGifsResult } from './searchService';

type DatabasePool = Pick<Pool, 'query'>;

interface FallbackRow extends QueryResultRow {
  id: string;
  source: string;
  title: string;
  description: string | null;
  category_id: string | null;
  url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  file_size_bytes: string | number | null;
  duration_ms: number | null;
  mime_type: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  total_count: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapGif(row: FallbackRow): GifSummary {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    description: row.description,
    categoryId: row.category_id,
    url: row.url,
    thumbnailUrl: row.thumbnail_url,
    width: row.width,
    height: row.height,
    fileSizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    durationMs: row.duration_ms,
    mimeType: row.mime_type,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// Table-qualified (`g.`) - unlike `services/categories/repository.ts`'s `GIF_COLUMNS`, this query
// joins `categories`/`gif_tags`/`tags` too, and several of those tables also have an `id` column.
const GIF_COLUMNS = `
  g.id, g.source, g.title, g.description, g.category_id, g.url, g.thumbnail_url,
  g.width, g.height, g.file_size_bytes, g.duration_ms, g.mime_type, g.status,
  g.created_at, g.updated_at
`;

/**
 * `$1` is the raw query text (fed to `plainto_tsquery` - safe/parameterised,
 * unlike `to_tsquery` it never interprets operators out of user input) and,
 * wrapped in `%...%`, to the tag `ILIKE` (`$2`). `$3` is the optional
 * category id-or-slug (same dual lookup `searchQuery.ts#buildCategoryFilter`
 * does for Elasticsearch, and `routes/categories.ts` for `:idOrSlug`) - null
 * short-circuits the filter. `COUNT(*) OVER()` (over the *filtered* rows,
 * before `LIMIT`/`OFFSET`) gets `pagination.total` in the same round trip
 * instead of a second query.
 */
const SEARCH_QUERY = `
  WITH q AS (SELECT plainto_tsquery('english', $1) AS tsq)
  SELECT ${GIF_COLUMNS}, COUNT(*) OVER() AS total_count
  FROM gifs g
  CROSS JOIN q
  LEFT JOIN categories c ON c.id = g.category_id
  WHERE g.status = 'active'
    AND (
      g.search_vector @@ q.tsq
      OR EXISTS (
        SELECT 1 FROM gif_tags gt JOIN tags t ON t.id = gt.tag_id
        WHERE gt.gif_id = g.id AND t.name ILIKE $2
      )
    )
    AND ($3::text IS NULL OR c.id::text = $3 OR c.slug = $3)
  ORDER BY ts_rank_cd(g.search_vector, q.tsq) DESC, g.updated_at DESC
  LIMIT $4 OFFSET $5
`;

/**
 * `GifSearchQueryServiceLike`-shaped Postgres fallback - see the module
 * doc comment above and `searchService.ts` for how/when it's used.
 * `database` defaults to the shared pool but can be swapped for a fake in
 * tests - see `test/search/postgresFallback.test.ts`.
 */
export class PostgresGifSearchFallback implements GifSearchFallbackLike {
  constructor(private readonly database: DatabasePool = pool) {}

  async search(params: GifSearchQueryParams): Promise<SearchGifsResult> {
    const result = await this.database.query<FallbackRow>(SEARCH_QUERY, [
      params.q,
      `%${params.q}%`,
      params.category ?? null,
      params.limit,
      params.offset,
    ]);

    const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
    return {
      items: result.rows.map(mapGif),
      total,
      limit: params.limit,
      offset: params.offset,
      degraded: true,
    };
  }
}

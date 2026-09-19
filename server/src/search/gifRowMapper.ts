/**
 * Shared Postgres row shape/mapping for a `gifs` row -> the `GifSummary` shape the frontend contract
 * expects (`web/src/lib/api.ts#searchGifs`). Used by both search backends (L42-463):
 *
 * - The Elasticsearch-backed `GifSearchQueryService` (`searchService.ts`) ranks in Elasticsearch, then
 *   hydrates the matching ids from Postgres with these columns/mapping.
 * - The Postgres-backed `PostgresGifSearchQueryService` (`postgresSearchService.ts`) ranks *and* reads
 *   these same columns in one query.
 *
 * Sharing this file (rather than each backend keeping its own copy) is what keeps the two backends'
 * `{ data, pagination }` response byte-identical - see `routes/search.ts`.
 */
import type { QueryResultRow } from 'pg';
import type { GifSummary } from '../services/categories';

export interface GifRow extends QueryResultRow {
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
}

const GIF_COLUMN_NAMES = [
  'id',
  'source',
  'title',
  'description',
  'category_id',
  'url',
  'thumbnail_url',
  'width',
  'height',
  'file_size_bytes',
  'duration_ms',
  'mime_type',
  'status',
  'created_at',
  'updated_at',
] as const;

/** Bare (unqualified) column list - for queries selecting straight from `gifs` with no alias/join. */
export const GIF_COLUMNS = GIF_COLUMN_NAMES.join(', ');

/** Same columns, qualified with a table alias (e.g. `g`) - for queries that join `gifs` to other tables. */
export function qualifiedGifColumns(alias: string): string {
  return GIF_COLUMN_NAMES.map((column) => `${alias}.${column}`).join(', ');
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function mapGif(row: GifRow): GifSummary {
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

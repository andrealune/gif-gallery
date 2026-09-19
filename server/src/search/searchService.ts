/**
 * Query side of the search integration: runs the ranked/filtered
 * Elasticsearch query built by `searchQuery.ts` against the `gifs` alias,
 * then hydrates the matching ids into full, display-ready `GifSummary` rows
 * from Postgres (same shape/columns `services/categories/repository.ts`
 * already returns for `/categories/:idOrSlug/gifs`, so the frontend's
 * `GifSummary` contract - width/height/fileSizeBytes/durationMs/mimeType,
 * none of which the search index stores - is satisfied either way a gif is
 * listed).
 *
 * Two round trips (Elasticsearch for ranking + ids, Postgres for display
 * fields) rather than one: it keeps the search index lean (just what
 * ranking/filtering need, per `gifsIndex.ts`) and Postgres as the single
 * source of truth for how a gif renders, instead of duplicating every
 * display column into the index and keeping two copies in sync. At the
 * result set sizes here (`limit`, capped well below the index size) it's a
 * single indexed `WHERE id = ANY($1)` lookup, not a per-row query.
 */
import type { Client } from '@elastic/elasticsearch';
import type { SearchTotalHits } from '@elastic/elasticsearch/lib/api/types';
import type { Pool, QueryResultRow } from 'pg';
import { pool } from '../db/pool';
import type { GifSummary } from '../services/categories';
import { getElasticsearchClient } from './client';
import { GIFS_ALIAS } from './pipeline';
import { buildSearchRequest, type GifSearchQueryParams } from './searchQuery';

type DatabasePool = Pick<Pool, 'query'>;

export interface SearchGifsResult {
  items: GifSummary[];
  total: number;
  limit: number;
  offset: number;
}

/** What `routes/search.ts` depends on - lets tests supply a fake instead of hitting real ES/Postgres. */
export interface GifSearchQueryServiceLike {
  search(params: GifSearchQueryParams): Promise<SearchGifsResult>;
}

interface GifRow extends QueryResultRow {
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

const GIF_COLUMNS = `
  id, source, title, description, category_id, url, thumbnail_url,
  width, height, file_size_bytes, duration_ms, mime_type, status,
  created_at, updated_at
`;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapGif(row: GifRow): GifSummary {
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

function extractTotal(total: SearchTotalHits | number | undefined): number {
  if (total === undefined) return 0;
  return typeof total === 'number' ? total : total.value;
}

/**
 * `GET /api/search` (L42-420). `esClient`/`database` default to the shared
 * Elasticsearch client / Postgres pool but can be swapped for fakes in
 * tests - see `test/search/searchService.test.ts`.
 */
export class GifSearchQueryService implements GifSearchQueryServiceLike {
  constructor(
    private readonly esClient: Client = getElasticsearchClient(),
    private readonly database: DatabasePool = pool,
    private readonly alias: string = GIFS_ALIAS
  ) {}

  async search(params: GifSearchQueryParams): Promise<SearchGifsResult> {
    const request = buildSearchRequest(this.alias, params);
    const response = await this.esClient.search(request);

    const total = extractTotal(response.hits.total);
    const ids = response.hits.hits
      .map((hit) => hit._id)
      .filter((id): id is string => typeof id === 'string');

    if (ids.length === 0) {
      return { items: [], total, limit: params.limit, offset: params.offset };
    }

    const items = await this.hydrate(ids);
    return { items, total, limit: params.limit, offset: params.offset };
  }

  /** Fetches `ids` from Postgres and re-orders them to match Elasticsearch's ranking (`ids`' order). */
  private async hydrate(ids: string[]): Promise<GifSummary[]> {
    const result = await this.database.query<GifRow>(
      `SELECT ${GIF_COLUMNS} FROM gifs WHERE id = ANY($1) AND status = 'active'`,
      [ids]
    );
    const byId = new Map(result.rows.map((row) => [row.id, row]));

    return ids
      .map((id) => byId.get(id))
      .filter((row): row is GifRow => row !== undefined)
      .map(mapGif);
  }
}

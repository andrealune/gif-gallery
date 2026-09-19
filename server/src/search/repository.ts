/**
 * Reads the rows the indexing pipeline needs from Postgres: one row per
 * *active* gif (matches the public listing convention -- see
 * `services/categories` -- archived/flagged/soft-deleted gifs are not
 * searchable), joined with its category and the names of all its tags.
 *
 * Paginated by keyset on `id` (not OFFSET) so a full reindex of 100k rows
 * stays O(1) per page instead of degrading as the offset grows, and so a row
 * inserted mid-run can't shift a later page and get skipped or duplicated.
 */
import type { Pool, QueryResultRow } from 'pg';
import { pool } from '../db/pool';
import type { GifSearchSourceRow } from './documentMapper';

type DatabasePool = Pick<Pool, 'query'>;

interface GifSearchSourceQueryRow extends QueryResultRow, GifSearchSourceRow {}

const FETCH_BATCH_QUERY = `
  SELECT
    g.id,
    g.title,
    g.description,
    g.status,
    g.source,
    g.url,
    g.thumbnail_url,
    g.created_at,
    g.updated_at,
    c.id   AS category_id,
    c.name AS category_name,
    c.slug AS category_slug,
    COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
  FROM gifs g
  LEFT JOIN categories c ON c.id = g.category_id
  LEFT JOIN gif_tags gt ON gt.gif_id = g.id
  LEFT JOIN tags t ON t.id = gt.tag_id
  WHERE g.status = 'active'
    AND ($1::uuid IS NULL OR g.id > $1::uuid)
  GROUP BY g.id, c.id
  ORDER BY g.id
  LIMIT $2
`;

/**
 * Keyset cursor for `fetchChanges`: the `(updated_at, id)` of the last row
 * seen in the previous page. `id` breaks ties between rows updated in the
 * same transaction (identical `updated_at`), the same way `fetchBatch`'s
 * plain `id` cursor breaks ties for a full reindex.
 */
export interface GifSyncCursor {
  updatedAt: string;
  id: string;
}

/**
 * Every gif whose `updated_at` moved past `after`, in *any* status --
 * unlike `fetchBatch`, deliberately not filtered to `status = 'active'`,
 * because the sync job (see `syncJob.ts`, L42-419) needs to see a gif that
 * *left* the active set (archived/flagged/soft-deleted) too, so it can
 * remove it from the index rather than leaving a stale document behind.
 */
const FETCH_CHANGES_QUERY = `
  SELECT
    g.id,
    g.title,
    g.description,
    g.status,
    g.source,
    g.url,
    g.thumbnail_url,
    g.created_at,
    g.updated_at,
    c.id   AS category_id,
    c.name AS category_name,
    c.slug AS category_slug,
    COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
  FROM gifs g
  LEFT JOIN categories c ON c.id = g.category_id
  LEFT JOIN gif_tags gt ON gt.gif_id = g.id
  LEFT JOIN tags t ON t.id = gt.tag_id
  WHERE ($1::timestamptz IS NULL OR (g.updated_at, g.id) > ($1::timestamptz, $2::uuid))
  GROUP BY g.id, c.id
  ORDER BY g.updated_at, g.id
  LIMIT $3
`;

/**
 * Public surface `pipeline.ts` depends on. `GifSearchSourceRepository`
 * implements this; tests substitute a plain fake object instead of standing
 * up a real database (see `test/search/pipeline.test.ts`), the same way
 * `services/categories`' `CategoryRepositoryLike` is faked in its tests.
 */
export interface GifSearchSourceRepositoryLike {
  fetchBatch(afterId: string | null, limit: number): Promise<GifSearchSourceRow[]>;
  countActive(): Promise<number>;
}

/**
 * Separate, narrower surface `syncJob.ts` depends on. Kept distinct from
 * `GifSearchSourceRepositoryLike` (rather than adding `fetchChanges` to it)
 * so existing `reindexAllGifs` callers/tests that fake only `fetchBatch`/
 * `countActive` are unaffected -- `GifSearchSourceRepository` implements
 * both.
 */
export interface GifSearchSyncRepositoryLike {
  fetchChanges(after: GifSyncCursor | null, limit: number): Promise<GifSearchSourceRow[]>;
}

export class GifSearchSourceRepository implements GifSearchSourceRepositoryLike, GifSearchSyncRepositoryLike {
  constructor(private readonly database: DatabasePool = pool) {}

  /** Next page of up to `limit` active gifs with id > `afterId` (null fetches the first page), ordered by id. */
  async fetchBatch(afterId: string | null, limit: number): Promise<GifSearchSourceRow[]> {
    const result = await this.database.query<GifSearchSourceQueryRow>(FETCH_BATCH_QUERY, [afterId, limit]);
    return result.rows;
  }

  /** Total number of active gifs, e.g. for progress reporting during a reindex. */
  async countActive(): Promise<number> {
    const result = await this.database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM gifs WHERE status = 'active'`
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Next page of up to `limit` gifs (any status) whose `(updated_at, id)`
   * is greater than `after` (null fetches the first page ever), ordered by
   * `updated_at, id`. Used by the sync job to discover inserts/updates/
   * archival since the last poll.
   */
  async fetchChanges(after: GifSyncCursor | null, limit: number): Promise<GifSearchSourceRow[]> {
    const result = await this.database.query<GifSearchSourceQueryRow>(FETCH_CHANGES_QUERY, [
      after?.updatedAt ?? null,
      after?.id ?? null,
      limit,
    ]);
    return result.rows;
  }
}

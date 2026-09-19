/**
 * Postgres-backed fallback implementation of `GifSearchQueryServiceLike` (L42-463): ranks and hydrates
 * results in a single query, using the `gifs.search_vector` generated `tsvector` column (title/
 * description, weighted `A`/`B` - see `migrations/0005_create_gifs_table.up.sql`) plus the gif's
 * category name and tag names, added on the fly (they are not part of `search_vector` - the columns it
 * generates from are fixed at the schema level - but `searchQuery.ts#SEARCH_FIELDS` includes both for
 * the Elasticsearch path, so this mirrors that as closely as a fallback reasonably can).
 *
 * Selected instead of the Elasticsearch-backed `GifSearchQueryService` when `SEARCH_BACKEND=postgres`
 * (or `auto` with no cluster configured) - see `backend.ts`. Every preview environment uses this path
 * per ADR 0001 (previews deliberately have no Elasticsearch cluster).
 *
 * Deliberately no `CREATE EXTENSION` (no `pg_trgm`, no fuzzy/trigram matching): the embedded PGlite
 * engine `test/migrations.test.ts` runs against has no contrib extensions available at all, and this
 * fallback only uses core Postgres full-text search (`tsvector`/`tsquery`, both built in since long
 * before this project's minimum supported version).
 *
 * Ranking quality is intentionally lower than the Elasticsearch path - see docs/elasticsearch.md's
 * "Postgres fallback" section:
 *   - Per-word prefix matching (`token:*`) instead of `fuzziness: 'AUTO'` - typos are not tolerated,
 *     only partial trailing words (good enough for the header typeahead's common case of an
 *     in-progress word, e.g. "danc" -> "dancing").
 *   - No cross-field relevance boosting beyond `search_vector`'s fixed per-field weights (title `A`,
 *     description `B`); category name and tag names are folded in at the same implicit weight (`D`)
 *     rather than tuned like Elasticsearch's `title^3` boost.
 *   - Tag/category matching is computed per-request (a correlated subquery + `to_tsvector` call per
 *     row) rather than pre-indexed, so it does not benefit from `gifs_search_vector_idx`'s GIN index -
 *     acceptable at this project's target catalog size (`gifsIndex.ts`: 10k-100k documents) but not as
 *     fast as the Elasticsearch path at any scale.
 */
import type { Pool } from 'pg';
import { pool } from '../db/pool';
import { mapGif, qualifiedGifColumns, type GifRow } from './gifRowMapper';
import type { GifSearchQueryParams } from './searchQuery';
import type { GifSearchQueryServiceLike, SearchGifsResult } from './searchService';

type DatabasePool = Pick<Pool, 'query'>;

// Same UUID shape `services/categories/repository.ts#isUuid` / `searchQuery.ts#UUID_RE` match, so
// `category=` is treated as an id when it looks like one and as a slug otherwise.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GIF_COLUMNS_G = qualifiedGifColumns('g');

/**
 * Builds a `to_tsquery`-safe expression from free text: splits on anything that is not a Unicode
 * letter/digit, drops empty tokens, and suffixes each surviving token with `:*` so a partial word (as
 * typed into the header's typeahead) still matches, e.g. "danc" -> "danc:*" matches "dancing". Returns
 * `null` when nothing is left to search on (e.g. `q` was only punctuation), so the caller can skip the
 * query entirely instead of asking Postgres to evaluate an empty tsquery (which matches nothing anyway,
 * but for the wrong reason).
 */
function toPrefixTsQuery(q: string): string | null {
  const tokens = q.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token}:*`).join(' & ');
}

interface CategoryFilter {
  sql: string;
  value: string;
}

/** Mirrors `searchQuery.ts#buildCategoryFilter` - `category` matches either the category's id or its slug. */
function buildCategoryFilter(category: string, paramIndex: number): CategoryFilter {
  return UUID_RE.test(category)
    ? { sql: `g.category_id = $${paramIndex}`, value: category }
    : { sql: `c.slug = $${paramIndex}`, value: category };
}

interface RankedGifRow extends GifRow {
  rank: number | string;
}

/**
 * `GET /api/search`'s Postgres-backed implementation of `GifSearchQueryServiceLike` - same
 * `{ items, total, limit, offset }` contract as the Elasticsearch-backed `GifSearchQueryService`, so
 * `routes/search.ts` (and therefore `web/src/lib/api.ts#searchGifs`) needs no change either way.
 * `database` defaults to the shared Postgres pool but can be swapped for a fake/PGlite instance in
 * tests - see `test/search/postgresSearchService.test.ts`.
 */
export class PostgresGifSearchQueryService implements GifSearchQueryServiceLike {
  constructor(private readonly database: DatabasePool = pool) {}

  async search(params: GifSearchQueryParams): Promise<SearchGifsResult> {
    const tsQuery = toPrefixTsQuery(params.q);
    if (!tsQuery) {
      return { items: [], total: 0, limit: params.limit, offset: params.offset };
    }

    const queryParams: unknown[] = [tsQuery];
    let categoryFilterSql = '';
    if (params.category) {
      const filter = buildCategoryFilter(params.category, queryParams.length + 1);
      categoryFilterSql = `AND ${filter.sql}`;
      queryParams.push(filter.value);
    }

    // `matches`: every active gif whose title/description/category name/tag names match `tsQuery`,
    // with the combined tsvector kept around as `doc_vector` so both queries below can reuse it
    // (rank ordering for the page, and a plain count for `total`) without repeating the join logic.
    const matchesCte = `
      WITH matches AS (
        SELECT
          ${GIF_COLUMNS_G},
          (
            g.search_vector
              || to_tsvector('english', coalesce(c.name, ''))
              || to_tsvector('english', coalesce(tag_names.names, ''))
          ) AS doc_vector
        FROM gifs g
        LEFT JOIN categories c ON c.id = g.category_id
        LEFT JOIN LATERAL (
          SELECT string_agg(t.name, ' ') AS names
          FROM gif_tags gt
          JOIN tags t ON t.id = gt.tag_id
          WHERE gt.gif_id = g.id
        ) tag_names ON true
        WHERE g.status = 'active'
        ${categoryFilterSql}
      )
    `;

    const limitIndex = queryParams.length + 1;
    const offsetIndex = queryParams.length + 2;

    const [rows, count] = await Promise.all([
      this.database.query<RankedGifRow>(
        `${matchesCte}
         SELECT *, ts_rank(doc_vector, to_tsquery('english', $1)) AS rank
         FROM matches
         WHERE doc_vector @@ to_tsquery('english', $1)
         ORDER BY rank DESC, updated_at DESC
         LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
        [...queryParams, params.limit, params.offset]
      ),
      this.database.query<{ count: string }>(
        `${matchesCte}
         SELECT COUNT(*)::int AS count
         FROM matches
         WHERE doc_vector @@ to_tsquery('english', $1)`,
        queryParams
      ),
    ]);

    return {
      items: rows.rows.map(mapGif),
      total: Number(count.rows[0]?.count ?? 0),
      limit: params.limit,
      offset: params.offset,
    };
  }
}

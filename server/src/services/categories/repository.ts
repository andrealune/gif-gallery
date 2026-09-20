import type { Pool, QueryResultRow } from 'pg';
import { pool } from '../../db/pool';
import type { PaginationParams } from '../../utils/pagination';
import { HttpError } from '../../middleware/errorHandler';
import { CategoryHasGenerationPromptsError, isForeignKeyViolation } from './errors';
import type { CategoryRepositoryLike, CategorySummary, GifSummary, Page } from './types';

type DatabasePool = Pick<Pool, 'query'>;

// RFC 4122 UUID, any version/variant - matches the `gen_random_uuid()` values `categories.id`/
// `gifs.id` are populated with. Used to tell a route param like `/categories/:idOrSlug` apart from
// a slug (e.g. "animals") without a round-trip, so we know which column to filter on.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

interface CategoryRow extends QueryResultRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  thumbnail_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  gif_count: string | number;
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

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapCategory(row: CategoryRow): CategorySummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    thumbnailUrl: row.thumbnail_url,
    gifCount: Number(row.gif_count),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
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

/**
 * L42-465: `categories.thumbnail_url` (migration 0012) is never written by any code path, so it
 * is `NULL` for every category and the derived `thumbnailUrl` below was always `null` too - see
 * ADR 0002 and L42-465 for the trail. Rather than backfilling/maintaining a column on write, we
 * derive it on read from the most recently created *active* gif in the category, exactly as the
 * approved L42-449 proposal specified: a single joined query using `DISTINCT ON`, not one query
 * per category (`N+1`).
 *
 * `COALESCE(thumbnail_url, url)` picks the gif's own `thumbnail_url` when the gif has one (e.g. a
 * Tenor "tinygif" preview) and otherwise falls back to its main `url`. Neither of those is a
 * generated static poster frame - this pipeline has no image-processing step that extracts one -
 * so `CategorySummary.thumbnailUrl` is always a *raw gif asset* (animated), same as
 * `GifSummary.thumbnailUrl`. `CategoryCard`/`GifCard` render it in a plain `<img>` with no
 * pause/reduced-motion control, which is the pre-existing WCAG 2.2.2 exposure ADR 0002 filed as
 * its own piece of work - this change does not introduce it and does not fix it.
 *
 * `c.thumbnail_url` itself is left in the `COALESCE` ahead of the derived value so that a future
 * write path (e.g. a category editor) that sets it explicitly always wins over the derived
 * "latest active gif" value, without any further code change here.
 */
const LATEST_ACTIVE_GIF_THUMBNAILS_CTE = `
  WITH latest_active_gif_thumbnails AS (
    SELECT DISTINCT ON (category_id)
      category_id,
      COALESCE(thumbnail_url, url) AS thumbnail_url
    FROM gifs
    WHERE status = 'active' AND category_id IS NOT NULL
    ORDER BY category_id, created_at DESC
  )
`;

const CATEGORY_COLUMNS = `
  c.id, c.name, c.slug, c.description,
  COALESCE(c.thumbnail_url, lgt.thumbnail_url) AS thumbnail_url,
  c.created_at, c.updated_at,
  COUNT(g.id) FILTER (WHERE g.status = 'active') AS gif_count
`;

const GIF_COLUMNS = `
  id, source, title, description, category_id, url, thumbnail_url,
  width, height, file_size_bytes, duration_ms, mime_type, status,
  created_at, updated_at
`;

// Name Postgres assigns the FK from `generation_prompts.category_id` to `categories(id)`
// (`<table>_<column>_fkey`, the default when the column's inline `REFERENCES` isn't given an
// explicit `CONSTRAINT` name - see migration 0009). It is deliberately `ON DELETE RESTRICT`
// (L42-444 / ADR-0001), unlike `gifs.category_id`'s `ON DELETE SET NULL` - a prompt without a
// category would violate BR-5, and cascading the delete would destroy the BR-3/BR-7 audit trail.
const GENERATION_PROMPTS_CATEGORY_FKEY = 'generation_prompts_category_id_fkey';

/**
 * Read/delete access to `categories` and the gifs assigned to them. A gif only counts towards
 * `gifCount`/appears in `listGifsByCategory` while `status = 'active'` (mirrors the
 * `gifs_active_created_at_idx` partial index - archived/flagged/soft-deleted gifs are excluded
 * from public listings, same as the rest of the catalog). `thumbnailUrl` is derived the same way,
 * see `LATEST_ACTIVE_GIF_THUMBNAILS_CTE` above.
 */
export class CategoryRepository implements CategoryRepositoryLike {
  constructor(private readonly database: DatabasePool = pool) {}

  async listCategories({ limit, offset }: PaginationParams): Promise<Page<CategorySummary>> {
    const [rows, count] = await Promise.all([
      this.database.query<CategoryRow>(
        `${LATEST_ACTIVE_GIF_THUMBNAILS_CTE}
         SELECT ${CATEGORY_COLUMNS}
         FROM categories c
         LEFT JOIN gifs g ON g.category_id = c.id
         LEFT JOIN latest_active_gif_thumbnails lgt ON lgt.category_id = c.id
         GROUP BY c.id, lgt.thumbnail_url
         ORDER BY c.name ASC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      this.database.query<{ count: string }>('SELECT COUNT(*)::int AS count FROM categories'),
    ]);

    return {
      items: rows.rows.map(mapCategory),
      total: Number(count.rows[0]?.count ?? 0),
      limit,
      offset,
    };
  }

  async findCategory(idOrSlug: string): Promise<CategorySummary | null> {
    const column = isUuid(idOrSlug) ? 'c.id' : 'c.slug';
    const result = await this.database.query<CategoryRow>(
      `${LATEST_ACTIVE_GIF_THUMBNAILS_CTE}
       SELECT ${CATEGORY_COLUMNS}
       FROM categories c
       LEFT JOIN gifs g ON g.category_id = c.id
       LEFT JOIN latest_active_gif_thumbnails lgt ON lgt.category_id = c.id
       WHERE ${column} = $1
       GROUP BY c.id, lgt.thumbnail_url`,
      [idOrSlug]
    );

    const row = result.rows[0];
    return row ? mapCategory(row) : null;
  }

  /** `categoryId` must already be a resolved category UUID - callers look it up via `findCategory` first. */
  async listGifsByCategory(categoryId: string, { limit, offset }: PaginationParams): Promise<Page<GifSummary>> {
    const [rows, count] = await Promise.all([
      this.database.query<GifRow>(
        `SELECT ${GIF_COLUMNS}
         FROM gifs
         WHERE category_id = $1 AND status = 'active'
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [categoryId, limit, offset]
      ),
      this.database.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM gifs WHERE category_id = $1 AND status = 'active'`,
        [categoryId]
      ),
    ]);

    return {
      items: rows.rows.map(mapGif),
      total: Number(count.rows[0]?.count ?? 0),
      limit,
      offset,
    };
  }

  /**
   * Deletes a category. `gifs` pointing at it are un-categorized automatically (`ON DELETE SET
   * NULL`, unchanged by this method - no application code needed there).
   *
   * `generation_prompts` is different on purpose: its FK to `categories` is `ON DELETE RESTRICT`
   * (L42-444 / ADR-0001, migration 0009), so a category that still has prompt rows cannot be
   * deleted at all - not even a cascade, because that would silently destroy the BR-3/BR-7 audit
   * trail. We check for blocking rows up front (the common case: a clear, accurate count in the
   * error) and also catch the FK violation itself as a race-condition safety net (a prompt
   * inserted between the check and the `DELETE`), so callers only ever see `404` or `409` here,
   * never an unhandled `23503`.
   *
   * See `docs/database-schema.md#category-retirement` for the operator-facing
   * deactivate-then-purge-then-delete procedure this error is meant to point people at.
   */
  async deleteCategory(idOrSlug: string): Promise<void> {
    const category = await this.findCategory(idOrSlug);
    if (!category) {
      throw new HttpError(404, `Category not found: ${idOrSlug}`);
    }

    const blockingCount = await this.countGenerationPrompts(category.id);
    if (blockingCount > 0) {
      throw new CategoryHasGenerationPromptsError(blockingCount);
    }

    try {
      await this.database.query('DELETE FROM categories WHERE id = $1', [category.id]);
    } catch (err) {
      if (isForeignKeyViolation(err, GENERATION_PROMPTS_CATEGORY_FKEY) || isForeignKeyViolation(err)) {
        // Either a specifically-named FK match, or (belt-and-suspenders, in case the driver in use
        // doesn't report `constraint`) any other 23503 while deleting a category: re-check rather
        // than guess, so the count in the error is always accurate.
        const recount = await this.countGenerationPrompts(category.id);
        if (recount > 0) {
          throw new CategoryHasGenerationPromptsError(recount);
        }
      }
      throw err;
    }
  }

  private async countGenerationPrompts(categoryId: string): Promise<number> {
    const result = await this.database.query<{ count: string }>(
      'SELECT COUNT(*)::int AS count FROM generation_prompts WHERE category_id = $1',
      [categoryId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}

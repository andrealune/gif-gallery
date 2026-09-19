import type { Pool, QueryResultRow } from 'pg';
import { pool } from '../../db/pool';
import type { PaginationParams } from '../../utils/pagination';
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

const CATEGORY_COLUMNS = `
  c.id, c.name, c.slug, c.description, c.thumbnail_url, c.created_at, c.updated_at,
  COUNT(g.id) FILTER (WHERE g.status = 'active') AS gif_count
`;

const GIF_COLUMNS = `
  id, source, title, description, category_id, url, thumbnail_url,
  width, height, file_size_bytes, duration_ms, mime_type, status,
  created_at, updated_at
`;

/**
 * Read access to `categories` and the gifs assigned to them. A gif only counts towards
 * `gifCount`/appears in `listGifsByCategory` while `status = 'active'` (mirrors the
 * `gifs_active_created_at_idx` partial index - archived/flagged/soft-deleted gifs are excluded
 * from public listings, same as the rest of the catalog).
 */
export class CategoryRepository implements CategoryRepositoryLike {
  constructor(private readonly database: DatabasePool = pool) {}

  async listCategories({ limit, offset }: PaginationParams): Promise<Page<CategorySummary>> {
    const [rows, count] = await Promise.all([
      this.database.query<CategoryRow>(
        `SELECT ${CATEGORY_COLUMNS}
         FROM categories c
         LEFT JOIN gifs g ON g.category_id = c.id
         GROUP BY c.id
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
      `SELECT ${CATEGORY_COLUMNS}
       FROM categories c
       LEFT JOIN gifs g ON g.category_id = c.id
       WHERE ${column} = $1
       GROUP BY c.id`,
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
}

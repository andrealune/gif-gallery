import type { Pool, QueryResultRow } from 'pg';
import { pool } from '../../db/pool';
import type { GifDetail, GifRepositoryLike } from './types';

type DatabasePool = Pick<Pool, 'query'>;

// RFC 4122 UUID, any version/variant - same detection `services/categories/repository.ts` uses to
// tell a route param like `/gifs/:idOrSlug` apart from a slug (e.g. "clapping-cat-4f9a1c") without
// a round-trip, so we know which column to filter on.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

interface GifRow extends QueryResultRow {
  id: string;
  source: string;
  title: string;
  description: string | null;
  category_id: string | null;
  url: string;
  thumbnail_url: string | null;
  slug: string;
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

function mapGif(row: GifRow): GifDetail {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    description: row.description,
    categoryId: row.category_id,
    url: row.url,
    thumbnailUrl: row.thumbnail_url,
    slug: row.slug,
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

const GIF_COLUMNS = `
  id, source, title, description, category_id, url, thumbnail_url, slug,
  width, height, file_size_bytes, duration_ms, mime_type, status,
  created_at, updated_at
`;

/**
 * Read access to a single gif by id or slug, for `GET /api/gifs/:idOrSlug` (L42-448). Mirrors
 * `CategoryRepository.findCategory` (`../categories/repository.ts`): same id-vs-slug detection,
 * and the same "only `status = 'active'` is publicly visible" rule the rest of the catalog uses
 * (see `CategoryRepository.listGifsByCategory`, `search/repository.ts`) - archived/flagged/
 * soft-deleted gifs 404 instead of leaking through the public detail endpoint.
 *
 * Depends on `gifs.slug` (a URL-safe, unique column - see L42-448's `database-engineer` follow-up
 * for the migration that adds it). Until that migration lands, every lookup by slug returns null
 * and lookups by id error at the database (column does not exist) - the same "not migrated yet"
 * situation `services/sitemap.ts` was already written to tolerate for the equivalent query.
 */
export class GifRepository implements GifRepositoryLike {
  constructor(private readonly database: DatabasePool = pool) {}

  async findGif(idOrSlug: string): Promise<GifDetail | null> {
    const column = isUuid(idOrSlug) ? 'id' : 'slug';
    const result = await this.database.query<GifRow>(
      `SELECT ${GIF_COLUMNS} FROM gifs WHERE ${column} = $1 AND status = 'active'`,
      [idOrSlug]
    );

    const row = result.rows[0];
    return row ? mapGif(row) : null;
  }
}

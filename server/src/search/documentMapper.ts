/**
 * Shape of a `gifs` search document (matches `gifsIndex.ts#GIFS_INDEX_MAPPING`)
 * and the mapper from a Postgres row (see `repository.ts`) to it.
 */
export interface GifSearchDocument {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  category: { id: string; name: string; slug: string } | null;
  status: string;
  source: string;
  url: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GifSearchSourceRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  source: string;
  url: string;
  thumbnail_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  tags: string[] | null;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Maps a joined `gifs`+`categories`+`tags` row (see `repository.ts`) to the document shape stored in Elasticsearch. */
export function toGifDocument(row: GifSearchSourceRow): GifSearchDocument {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tags: row.tags ?? [],
    category:
      row.category_id !== null
        ? { id: row.category_id, name: row.category_name ?? '', slug: row.category_slug ?? '' }
        : null,
    status: row.status,
    source: row.source,
    url: row.url,
    thumbnailUrl: row.thumbnail_url,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

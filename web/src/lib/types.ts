/**
 * Shapes returned by the gallery API (server/src/services/categories/types.ts is the source of
 * truth - keep these in sync when the backend contract changes).
 */

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** Number of active gifs currently assigned to this category. */
  gifCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GifSummary {
  id: string;
  source: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  fileSizeBytes: number | null;
  durationMs: number | null;
  mimeType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

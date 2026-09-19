import type { PaginationParams } from '../../utils/pagination';

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /**
   * URL of the category's thumbnail image, or `null` when none has been set. Backs L42-450
   * (<CategoryCard> on the frontend), which falls back to an emoji placeholder whenever this is
   * null (or absent from an older API response). Added by L42-462 - L42-449 had previously been
   * marked "done" in the tracker without this field (or the underlying `thumbnail_url` column,
   * see migration 0012) ever actually landing.
   */
  thumbnailUrl: string | null;
  /** Number of *active* (non-archived/flagged/deleted) gifs currently assigned to this category. */
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

/**
 * Public surface `routes/categories.ts` depends on. `CategoryRepository` implements this; tests
 * substitute a plain fake object instead of standing up a real database (see
 * `test/categories/routes.test.ts`), the same way `services/tenor` tests inject a fake pool.
 */
export interface CategoryRepositoryLike {
  listCategories(params: PaginationParams): Promise<Page<CategorySummary>>;
  /** Looks a category up by UUID `id` or by `slug`. Returns null if neither matches. */
  findCategory(idOrSlug: string): Promise<CategorySummary | null>;
  /** `categoryId` must be a resolved category UUID (e.g. from `findCategory`), not a slug. */
  listGifsByCategory(categoryId: string, params: PaginationParams): Promise<Page<GifSummary>>;
}

/**
 * A single gif's full public detail, used by `GET /api/gifs/:idOrSlug` (L42-448) - the data path
 * `web/src/app/gif/[slug]/page.tsx`'s `generateMetadata` (L42-431) needs for dynamic Open Graph/
 * Twitter Card tags. Field set mirrors `services/categories/types.ts#GifSummary` plus the
 * `slug` the frontend's `GifDetail` (`web/src/lib/api.ts`) already expects.
 */
export interface GifDetail {
  id: string;
  source: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  url: string;
  thumbnailUrl: string | null;
  slug: string;
  width: number | null;
  height: number | null;
  fileSizeBytes: number | null;
  durationMs: number | null;
  mimeType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public surface `routes/gifs.ts` depends on. `GifRepository` implements this; tests substitute a
 * plain fake object instead of standing up a real database (see `test/gifs/routes.test.ts`), the
 * same way `services/categories` tests do.
 */
export interface GifRepositoryLike {
  /** Looks a gif up by UUID `id` or by `slug`, restricted to `status = 'active'`. Returns null if neither matches. */
  findGif(idOrSlug: string): Promise<GifDetail | null>;
}

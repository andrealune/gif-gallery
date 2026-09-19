import type { CategorySummary, GifSummary } from '@/lib/types';
import { GifCard } from './GifCard';

export function GifGrid({
  gifs,
  categories,
}: {
  gifs: GifSummary[];
  /**
   * Optional `categoryId -> category` lookup so each card can show which category a result
   * belongs to. Most callers (a single category's page, the homepage's per-category rail) already
   * know the category from context and skip this prop entirely; the search results page
   * (L42-428), whose results span every category, is the one that builds and passes it (see
   * `app/search/page.tsx`). See `GifCard`'s `category` prop for how it's used per card.
   */
  categories?: Map<string, CategorySummary>;
}) {
  return (
    <ul role="list" className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {gifs.map((gif) => (
        <li key={gif.id}>
          <GifCard gif={gif} category={(gif.categoryId && categories?.get(gif.categoryId)) || null} />
        </li>
      ))}
    </ul>
  );
}

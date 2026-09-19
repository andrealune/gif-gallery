import type { CategorySummary } from '@/lib/types';
import { CategoryCard } from './CategoryCard';

export function CategoryGrid({ categories }: { categories: CategorySummary[] }) {
  return (
    <ul role="list" className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {categories.map((category) => (
        <li key={category.id}>
          <CategoryCard category={category} />
        </li>
      ))}
    </ul>
  );
}

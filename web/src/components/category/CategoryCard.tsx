import Link from 'next/link';
import type { CategorySummary } from '@/lib/types';

export function CategoryCard({ category }: { category: CategorySummary }) {
  return (
    <Link
      href={`/category/${category.slug}`}
      className="group block overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      <div
        aria-hidden="true"
        className="flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br from-brand-100 to-brand-300 text-4xl"
      >
        🎬
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-slate-900 group-hover:text-brand-700">{category.name}</h3>
        {category.description ? (
          <p className="mt-1 line-clamp-2 text-sm text-slate-500">{category.description}</p>
        ) : null}
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          {category.gifCount} {category.gifCount === 1 ? 'gif' : 'gifs'}
        </p>
      </div>
    </Link>
  );
}

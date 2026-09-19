import type { Metadata } from 'next';
import { ApiError, getCategories } from '@/lib/api';
import { CategoryGrid } from '@/components/category/CategoryGrid';
import { Container } from '@/components/layout/Container';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SearchForm } from '@/components/search/SearchForm';
import { SITE_DESCRIPTION } from '@/lib/config';
import { buildKeywords } from '@/lib/seo';

export const metadata: Metadata = {
  description: SITE_DESCRIPTION,
  keywords: buildKeywords('browse gifs', 'gif categories', 'free gifs'),
  alternates: { canonical: '/' },
  openGraph: { description: SITE_DESCRIPTION, url: '/' },
};

export default async function HomePage() {
  let categories: Awaited<ReturnType<typeof getCategories>>['items'] = [];
  let error: string | null = null;

  try {
    const page = await getCategories({ limit: 50 });
    categories = page.items;
  } catch (err) {
    error = err instanceof ApiError ? err.message : 'Unexpected error while loading categories.';
  }

  return (
    <>
      <section className="border-b border-slate-200 bg-gradient-to-b from-brand-50 to-white py-16">
        <Container className="text-center">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Find the perfect GIF
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">{SITE_DESCRIPTION}</p>
          <div className="mx-auto mt-8 max-w-xl">
            <SearchForm size="lg" />
          </div>
        </Container>
      </section>

      <Container className="py-10">
        <h2 className="text-xl font-semibold text-slate-900">Browse by category</h2>

        <div className="mt-6">
          {error ? (
            <ErrorState description={error} />
          ) : categories.length > 0 ? (
            <CategoryGrid categories={categories} />
          ) : (
            <EmptyState
              title="No categories yet"
              description="Check back soon - categories are being curated."
            />
          )}
        </div>
      </Container>
    </>
  );
}

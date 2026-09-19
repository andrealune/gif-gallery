import type { Metadata } from 'next';
import { ApiError, getCategories } from '@/lib/api';
import { CategoryGrid } from '@/components/category/CategoryGrid';
import { Container } from '@/components/layout/Container';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SearchForm } from '@/components/search/SearchForm';
import { SITE_DESCRIPTION } from '@/lib/config';
import { buildKeywords } from '@/lib/seo';

/**
 * Force this route to render per-request instead of being prerendered as static content at
 * `next build` time (L42-456).
 *
 * `getCategories()` below has no `cache: 'no-store'`/dynamic function to opt it out on its own -
 * unlike every other data-fetching route in this app (`/category/[slug]`, `/gif/[slug]`,
 * `/search`), which all read `searchParams` and are therefore already "server-rendered on demand"
 * (see their `ƒ` marker in `next build`'s route summary) - so Next.js was free to treat `/` as
 * static (`○`) and fetch `getCategories()` once, at build time, to bake into the prerendered HTML.
 *
 * `web/` and `server/` are separate services (separate `package.json`s, separate default ports),
 * so there's no guarantee the API is up and reachable from wherever `next build` runs - it very
 * often isn't (a CI/build step, or a preview whose `server` container hasn't started yet). When
 * it's unreachable, the exact "Could not reach the gallery API (...). Is the server running?"
 * message that `apiFetch` throws (see `lib/api.ts`) gets caught by the `try/catch` below same as
 * always, but the resulting `<ErrorState>` then gets frozen into that one static HTML file and
 * served to every visitor - it does *not* self-heal once the API comes up, since nothing here
 * ever requests as `/` again to trigger the `revalidate: 60` window `getCategories` sets.
 *
 * Forcing dynamic rendering makes `/` behave like the rest of the app: every request runs this
 * function fresh, against whatever server is actually reachable at request time, and `next build`
 * no longer touches the network (or the API) at all.
 */
export const dynamic = 'force-dynamic';

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

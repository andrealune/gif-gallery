import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, getCategoryGifs } from '@/lib/api';
import { Container } from '@/components/layout/Container';
import { GifCategoryBrowser } from '@/components/gif/GifCategoryBrowser';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { JsonLd } from '@/components/seo/JsonLd';
import { DEFAULT_PAGE_SIZE } from '@/lib/config';
import { buildKeywords, categoryOgDescription } from '@/lib/seo';
import { breadcrumbJsonLd, categoryJsonLd } from '@/lib/structuredData';

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ offset?: string }>;
}

function parseOffset(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '0', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    // `limit: 1` is enough to get the category itself plus one representative GIF for the
    // og:image/twitter:image preview, without paying for a full page of results just for <head>.
    const result = await getCategoryGifs(slug, { limit: 1 });
    if (!result) return { title: 'Category not found' };

    const { category, gifs } = result;
    const description = categoryOgDescription(category);
    const preview = gifs.items[0];
    const previewImage = preview ? preview.thumbnailUrl ?? preview.url : null;
    const url = `/category/${category.slug}`;
    const keywords = buildKeywords(category.name, `${category.name} gifs`, `${category.name} gif`);

    return {
      title: category.name,
      description,
      keywords,
      alternates: { canonical: url },
      openGraph: {
        title: category.name,
        description,
        url,
        images: previewImage
          ? [{ url: previewImage, alt: `${category.name} GIFs on this site` }]
          : undefined,
      },
      twitter: {
        card: previewImage ? 'summary_large_image' : 'summary',
        title: category.name,
        description,
        images: previewImage ? [previewImage] : undefined,
      },
    };
  } catch {
    return { title: 'Category' };
  }
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const { offset } = await searchParams;
  const safeOffset = parseOffset(offset);

  let result: Awaited<ReturnType<typeof getCategoryGifs>>;
  try {
    result = await getCategoryGifs(slug, { limit: DEFAULT_PAGE_SIZE, offset: safeOffset });
  } catch (err) {
    return (
      <Container className="py-10">
        <ErrorState
          description={err instanceof ApiError ? err.message : 'Unexpected error loading this category.'}
        />
      </Container>
    );
  }

  if (!result) notFound();

  const { category, gifs } = result;
  const url = `/category/${category.slug}`;

  return (
    <Container className="py-10">
      {/*
        `categoryJsonLd` only describes the GIFs actually rendered below (this page's first
        `DEFAULT_PAGE_SIZE` results, not every GIF in the category) so the structured data never
        overstates what's on the page - see the comment on `categoryJsonLd` itself.
      */}
      <JsonLd
        data={[
          categoryJsonLd(category, gifs.items, url),
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: category.name, path: url },
          ]),
        ]}
      />

      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="hover:text-brand-700">
          Home
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-slate-700">{category.name}</span>
      </nav>

      <h1 className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl">{category.name}</h1>
      {category.description ? <p className="mt-1 max-w-2xl text-slate-600">{category.description}</p> : null}
      <p className="mt-1 text-sm text-slate-400">
        {gifs.total} {gifs.total === 1 ? 'gif' : 'gifs'}
      </p>

      <div className="mt-8">
        {gifs.items.length > 0 ? (
          <>
            {/*
              With JavaScript, `GifCategoryBrowser` takes over: it renders this same first page and
              lazily fetches the rest as the user scrolls (or activates its "Load more" button).
              `key={category.slug}` forces a fresh instance - and fresh internal state - whenever the
              category changes. Without JavaScript the browser never mounts, so the real `Pagination`
              links below (normally invisible) are what's left to page through every gif.
            */}
            <GifCategoryBrowser key={category.slug} categorySlug={category.slug} initialGifs={gifs} />
            <noscript>
              <Pagination
                basePath={`/category/${category.slug}`}
                limit={gifs.limit}
                offset={gifs.offset}
                total={gifs.total}
              />
            </noscript>
          </>
        ) : (
          <EmptyState
            title="No GIFs in this category yet"
            description="Check back soon - new GIFs are added regularly."
          />
        )}
      </div>
    </Container>
  );
}

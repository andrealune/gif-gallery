import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, getCategoryGifs } from '@/lib/api';
import { Container } from '@/components/layout/Container';
import { GifGrid } from '@/components/gif/GifGrid';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { DEFAULT_PAGE_SIZE } from '@/lib/config';
import { truncate } from '@/lib/seo';

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
    const description = truncate(category.description ?? `Browse ${category.name} GIFs.`);
    const preview = gifs.items[0];
    const previewImage = preview ? preview.thumbnailUrl ?? preview.url : null;
    const url = `/category/${category.slug}`;

    return {
      title: category.name,
      description,
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

  return (
    <Container className="py-10">
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
            <GifGrid gifs={gifs.items} />
            <Pagination
              basePath={`/category/${category.slug}`}
              limit={gifs.limit}
              offset={gifs.offset}
              total={gifs.total}
            />
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

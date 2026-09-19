import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, getCategory, getCategoryGifs, getGif } from '@/lib/api';
import type { GifDetail } from '@/lib/api';
import type { CategorySummary, GifSummary } from '@/lib/types';
import { Container } from '@/components/layout/Container';
import { GifGrid } from '@/components/gif/GifGrid';
import { ShareEmbed } from '@/components/gif/ShareEmbed';
import { ErrorState } from '@/components/ui/ErrorState';
import { JsonLd } from '@/components/seo/JsonLd';
import { absoluteUrl, buildKeywords, gifOgDescription, gifOgImage, gifOgTitle } from '@/lib/seo';
import { breadcrumbJsonLd, gifJsonLd } from '@/lib/structuredData';
import { capitalize, formatDate, formatDuration, formatFileSize } from '@/lib/format';

interface GifPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Resolves the gif's category (name + slug for a link) from `categoryId`. `GET /api/gifs/:idOrSlug`
 * (`server/src/services/gifs/types.ts#GifDetail`) only returns the raw `categoryId`, not an
 * embedded category object, so this makes a second request via the existing `getCategory`
 * endpoint. Best-effort: any failure here (or no `categoryId`) just means the page renders without
 * a category - never a broken page over a "nice to have".
 */
async function getGifCategory(gif: GifDetail): Promise<CategorySummary | null> {
  if (!gif.categoryId) return null;
  try {
    return await getCategory(gif.categoryId);
  } catch {
    return null;
  }
}

/**
 * Other gifs from the same category, newest first, excluding this one. Best-effort: a failure
 * here (or the gif having no resolvable category) just means an empty "related" section, never a
 * broken page.
 */
async function getRelatedGifs(category: CategorySummary | null, gifId: string): Promise<GifSummary[]> {
  if (!category) return [];
  try {
    const result = await getCategoryGifs(category.slug, { limit: 13 });
    if (!result) return [];
    return result.gifs.items.filter((item) => item.id !== gifId).slice(0, 12);
  } catch {
    return [];
  }
}

/**
 * Dynamic Open Graph/Twitter Card metadata for a single GIF, so sharing a `/gif/:slug` link
 * renders a rich preview (title, description, image) in Slack/Discord/iMessage/X/Facebook etc.
 *
 * This is the App Router's replacement for `next/head`: this repo uses `app/` routing (see
 * `web/src/app/**`), where per-request `<head>` content comes from the `generateMetadata` export
 * (or a static `metadata` export) rather than rendering `next/head` inside the page body -
 * `next/head` is Pages Router-only and does not work inside Server Components. `category/[slug]`
 * and `search` already use this same API; this follows the same pattern for consistency.
 */
export async function generateMetadata({ params }: GifPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const gif = await getGif(slug);
    if (!gif) return { title: 'GIF not found' };

    const category = await getGifCategory(gif);
    const title = gifOgTitle(gif);
    const description = gifOgDescription(gif);
    const image = gifOgImage(gif);
    const url = `/gif/${gif.slug ?? gif.id}`;
    const keywords = buildKeywords(
      title,
      `${title} gif`,
      `${title} animated gif`,
      category?.name,
      ...(gif.tags ?? [])
    );

    return {
      title,
      description,
      keywords,
      alternates: { canonical: url },
      openGraph: {
        type: 'website',
        title,
        description,
        url,
        images: image ? [image] : undefined,
      },
      twitter: {
        card: image ? 'summary_large_image' : 'summary',
        title,
        description,
        images: image ? [image.url] : undefined,
      },
    };
  } catch {
    return { title: 'GIF' };
  }
}

export default async function GifPage({ params }: GifPageProps) {
  const { slug } = await params;

  let gif: GifDetail | null;
  try {
    gif = await getGif(slug);
  } catch (err) {
    return (
      <Container className="py-10">
        <ErrorState
          description={err instanceof ApiError ? err.message : 'Unexpected error loading this GIF.'}
        />
      </Container>
    );
  }

  if (!gif) notFound();

  const category = await getGifCategory(gif);
  const relatedGifs = await getRelatedGifs(category, gif.id);

  const title = gifOgTitle(gif);
  const pagePath = `/gif/${gif.slug ?? gif.id}`;
  const pageUrl = absoluteUrl(pagePath);
  const fileSize = formatFileSize(gif.fileSizeBytes);
  const duration = formatDuration(gif.durationMs);
  const dimensions = gif.width && gif.height ? `${gif.width}\u00d7${gif.height}px` : null;
  const tags = gif.tags ?? [];

  return (
    <Container className="py-10">
      <JsonLd
        data={[
          gifJsonLd(gif, pagePath),
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            ...(category ? [{ name: category.name, path: `/category/${category.slug}` }] : []),
            { name: title, path: pagePath },
          ]),
        ]}
      />

      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="hover:text-brand-700">
          Home
        </Link>
        <span aria-hidden="true">/</span>
        {category ? (
          <>
            <Link href={`/category/${category.slug}`} className="hover:text-brand-700">
              {category.name}
            </Link>
            <span aria-hidden="true">/</span>
          </>
        ) : null}
        <span className="max-w-[16rem] truncate text-slate-700">{title}</span>
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="flex items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element -- remote hosts aren't finalized, see next.config.mjs */}
            <img
              src={gif.url}
              alt={title}
              width={gif.width ?? undefined}
              height={gif.height ?? undefined}
              className="max-h-[70vh] w-auto"
            />
          </div>

          <h1 className="mt-6 text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
          {gif.description ? <p className="mt-2 max-w-2xl text-slate-600">{gif.description}</p> : null}

          {tags.length > 0 ? (
            <ul role="list" aria-label="Tags" className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <li key={tag}>
                  <Link
                    href={`/search?q=${encodeURIComponent(tag)}`}
                    className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-brand-100 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                  >
                    #{tag}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-400">Source</dt>
              <dd className="font-medium text-slate-700">{capitalize(gif.source)}</dd>
            </div>
            {category ? (
              <div>
                <dt className="text-slate-400">Category</dt>
                <dd>
                  <Link href={`/category/${category.slug}`} className="font-medium text-brand-700 hover:underline">
                    {category.name}
                  </Link>
                </dd>
              </div>
            ) : null}
            {dimensions ? (
              <div>
                <dt className="text-slate-400">Dimensions</dt>
                <dd className="font-medium text-slate-700">{dimensions}</dd>
              </div>
            ) : null}
            {duration ? (
              <div>
                <dt className="text-slate-400">Duration</dt>
                <dd className="font-medium text-slate-700">{duration}</dd>
              </div>
            ) : null}
            {fileSize ? (
              <div>
                <dt className="text-slate-400">File size</dt>
                <dd className="font-medium text-slate-700">{fileSize}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-slate-400">Added</dt>
              <dd className="font-medium text-slate-700">{formatDate(gif.createdAt)}</dd>
            </div>
          </dl>
        </div>

        <aside aria-label="Share this GIF" className="lg:pt-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Share &amp; embed</h2>
          <div className="mt-3">
            <ShareEmbed pageUrl={pageUrl} assetUrl={gif.url} title={title} width={gif.width} height={gif.height} />
          </div>
        </aside>
      </div>

      {relatedGifs.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-xl font-semibold text-slate-900">
            {category ? `More in ${category.name}` : 'Related GIFs'}
          </h2>
          <div className="mt-4">
            <GifGrid gifs={relatedGifs} />
          </div>
        </section>
      ) : null}
    </Container>
  );
}

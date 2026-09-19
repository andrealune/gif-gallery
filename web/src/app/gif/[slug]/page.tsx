import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, getGif } from '@/lib/api';
import { Container } from '@/components/layout/Container';
import { ErrorState } from '@/components/ui/ErrorState';
import { gifOgDescription, gifOgImage, gifOgTitle } from '@/lib/seo';

interface GifPageProps {
  params: Promise<{ slug: string }>;
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

    const title = gifOgTitle(gif);
    const description = gifOgDescription(gif);
    const image = gifOgImage(gif);
    const url = `/gif/${gif.slug ?? gif.id}`;

    return {
      title,
      description,
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

  let gif: Awaited<ReturnType<typeof getGif>>;
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

  const title = gifOgTitle(gif);

  return (
    <Container className="py-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/" className="hover:text-brand-700">
          Home
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-slate-700">{title}</span>
      </nav>

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element -- remote hosts aren't finalized, see next.config.mjs */}
          <img
            src={gif.url}
            alt={gif.title || 'Untitled GIF'}
            width={gif.width ?? undefined}
            height={gif.height ?? undefined}
            className="h-full w-full object-contain"
          />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{title}</h1>
          {gif.description ? <p className="mt-2 text-slate-600">{gif.description}</p> : null}
          <p className="mt-3 text-sm uppercase tracking-wide text-slate-400">{gif.source}</p>
        </div>
      </div>
    </Container>
  );
}

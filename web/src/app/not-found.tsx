import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@/components/layout/Container';

// Next.js already sends a real `404` status for this page, which is the primary signal crawlers
// use to skip indexing it - this `metadata` export is defense-in-depth (L42-434): some CDNs/static
// hosts can end up serving a not-found page with a `200`, and an explicit `noindex` keeps it out of
// search results either way.
export const metadata: Metadata = {
  title: 'Page not found',
  description: "The page you're looking for doesn't exist or may have moved.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <Container className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">404</p>
      <h1 className="text-2xl font-bold text-slate-900">We couldn&apos;t find that page</h1>
      <p className="max-w-md text-slate-500">
        The category or page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-full bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        Back to home
      </Link>
    </Container>
  );
}

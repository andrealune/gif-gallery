'use client';

import { useEffect } from 'react';
import { Container } from '@/components/layout/Container';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface unexpected render errors in the console for local/dev debugging. A real error
    // reporting integration (Sentry, etc.) is out of scope for this task.
    console.error(error);
  }, [error]);

  return (
    <Container className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-red-600">Error</p>
      <h1 className="text-2xl font-bold text-slate-900">Something went wrong</h1>
      <p className="max-w-md text-slate-500">
        We hit an unexpected error loading this page. Please try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-full bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        Try again
      </button>
    </Container>
  );
}

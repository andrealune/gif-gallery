import Link from 'next/link';
import { Container } from './Container';
import { SearchForm } from '../search/SearchForm';
import { SITE_NAME } from '@/lib/config';

export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <a href="#main-content" className="sr-only-focusable fixed top-2 left-2 z-50 rounded bg-brand-600 px-3 py-2 text-white">
        Skip to content
      </a>
      <Container className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <span aria-hidden="true" className="text-2xl">
            🎞️
          </span>
          {SITE_NAME}
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-4 text-sm font-medium text-slate-600">
          <Link href="/" className="hover:text-brand-700">
            Home
          </Link>
        </nav>

        <div className="sm:w-72">
          <SearchForm />
        </div>
      </Container>
    </header>
  );
}

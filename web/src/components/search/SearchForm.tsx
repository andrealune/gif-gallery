'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Progressive-enhancement search box: it's a plain GET form (`action="/search"`, `name="q"`) so
 * it works even before React hydrates, and `onSubmit` just takes over to keep the current value
 * in the URL tidy. Live autocomplete suggestions land in L42-428 - this intentionally only wires
 * up submit-to-navigate for now.
 */
export function SearchForm({
  defaultValue = '',
  className = '',
  size = 'md',
}: {
  defaultValue?: string;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const inputId = useId();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search');
  };

  const inputSize = size === 'lg' ? 'py-3 text-base' : 'py-2 text-sm';

  return (
    <form
      role="search"
      action="/search"
      method="get"
      onSubmit={handleSubmit}
      className={`flex w-full items-center gap-2 ${className}`}
    >
      <label htmlFor={inputId} className="sr-only">
        Search GIFs
      </label>
      <input
        id={inputId}
        name="q"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search GIFs…"
        autoComplete="off"
        className={`w-full rounded-full border border-slate-300 bg-white px-4 ${inputSize} text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600`}
      />
      <button
        type="submit"
        className="shrink-0 rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        Search
      </button>
    </form>
  );
}

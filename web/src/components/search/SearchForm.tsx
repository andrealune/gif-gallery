'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, getCategories, searchGifs } from '@/lib/api';
import type { CategorySummary, GifSummary } from '@/lib/types';

const SUGGESTION_LIMIT = 6;
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

/**
 * Progressive-enhancement search box: it's a plain GET form (`action="/search"`, `name="q"`) so
 * it works even before React hydrates, and `onSubmit` just takes over to keep the current value
 * in the URL tidy.
 *
 * On top of that (L42-428) it's a WAI-ARIA "combobox with list autocomplete" - as the user types,
 * `/api/search` is queried (debounced, cancel-stale-response-safe) for up to `SUGGESTION_LIMIT`
 * matching gifs, shown in a dropdown listbox with a thumbnail + title + source/category label.
 * Arrow keys move the highlighted option (`aria-activedescendant`), Enter on a highlighted option
 * completes the search box with its title and navigates to `/search?q=...` for it, and Enter with
 * nothing highlighted falls through to the normal "search for exactly what I typed" submit. If
 * `/api/search` is unavailable (offline, not deployed, ...) suggestions just silently stay empty -
 * typing and submitting the form is never blocked by it.
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
  const [suggestions, setSuggestions] = useState<GifSummary[]>([]);
  const [categories, setCategories] = useState<Map<string, CategorySummary>>(new Map());
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputId = useId();
  const listboxId = `${inputId}-listbox`;

  const formRef = useRef<HTMLFormElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const categoryMapRef = useRef<Map<string, CategorySummary> | null>(null);
  const categoryMapPromiseRef = useRef<Promise<Map<string, CategorySummary>> | null>(null);

  /**
   * Categories rarely change and only label the suggestion list (source/category caption per
   * option) - fetched at most once per mounted `<SearchForm>` (lazily, on the first suggestion
   * fetch) rather than on every keystroke. Best-effort: an empty map on failure just means
   * suggestions render without a category caption, never a broken dropdown.
   */
  const ensureCategoryMap = useCallback((): Promise<Map<string, CategorySummary>> => {
    if (categoryMapRef.current) return Promise.resolve(categoryMapRef.current);
    if (!categoryMapPromiseRef.current) {
      categoryMapPromiseRef.current = getCategories({ limit: 100 })
        .then((page) => {
          const map = new Map(page.items.map((category) => [category.id, category] as const));
          categoryMapRef.current = map;
          return map;
        })
        .catch(() => new Map<string, CategorySummary>());
    }
    return categoryMapPromiseRef.current;
  }, []);

  const runSearch = useCallback(
    (term: string) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);

      Promise.all([
        searchGifs(term, { limit: SUGGESTION_LIMIT }).catch((err) => {
          // Not available yet / not found / offline - degrade to "no suggestions" exactly like
          // the results page does, never a hard error that would disrupt typing.
          if (err instanceof ApiError) return null;
          throw err;
        }),
        ensureCategoryMap(),
      ])
        .then(([resultPage, categoryMap]) => {
          if (requestId !== requestIdRef.current) return; // superseded by a later keystroke
          setCategories(categoryMap);
          setSuggestions(resultPage?.items ?? []);
          setActiveIndex(-1);
          setOpen(true);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          setSuggestions([]);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    },
    [ensureCategoryMap]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Close the dropdown on any click outside the form (not just a blur - see the mousedown
  // handler on options below for why blur alone isn't used to decide this).
  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent) {
      if (formRef.current && !formRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setValue(next);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = next.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestIdRef.current += 1; // invalidate any in-flight fetch, its response is now stale
      setLoading(false);
      setSuggestions([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    debounceRef.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
  };

  const selectSuggestion = useCallback(
    (gif: GifSummary) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      requestIdRef.current += 1;
      const term = gif.title.trim() || value.trim();
      setValue(term);
      setSuggestions([]);
      setOpen(false);
      setActiveIndex(-1);
      router.push(term ? `/search?q=${encodeURIComponent(term)}` : '/search');
    },
    [router, value]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;

    switch (event.key) {
      case 'ArrowDown':
        if (suggestions.length === 0) return;
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        if (suggestions.length === 0) return;
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        break;
      case 'Enter':
        if (activeIndex >= 0 && suggestions[activeIndex]) {
          event.preventDefault();
          selectSuggestion(suggestions[activeIndex]);
        } else {
          setOpen(false); // let the form's own onSubmit search for exactly what was typed
        }
        break;
      case 'Escape':
        setOpen(false);
        setActiveIndex(-1);
        break;
      default:
        break;
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOpen(false);
    const trimmed = value.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search');
  };

  // `text-base` (16px) on both sizes, not just `lg` - anything smaller and iOS Safari auto-zooms
  // the whole page when this input receives focus (its zoom heuristic kicks in below 16px), which
  // is especially jarring for the `md` instance since that one sits in the header and is reachable
  // from every page. `md` keeps a tighter vertical size (`py-2` vs `py-3`) so it still reads as the
  // more compact of the two.
  const inputSize = size === 'lg' ? 'py-3 text-base' : 'py-2 text-base';
  const showListbox = open && suggestions.length > 0;
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <form
      ref={formRef}
      role="search"
      action="/search"
      method="get"
      onSubmit={handleSubmit}
      className={`relative flex w-full items-center gap-2 ${className}`}
    >
      <label htmlFor={inputId} className="sr-only">
        Search GIFs
      </label>
      <div className="relative w-full">
        <input
          id={inputId}
          name="q"
          type="search"
          role="combobox"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Search GIFs…"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={showListbox}
          aria-controls={listboxId}
          aria-activedescendant={showListbox ? activeOptionId : undefined}
          className={`w-full rounded-full border border-slate-300 bg-white px-4 ${inputSize} text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600`}
        />

        <span role="status" aria-live="polite" className="sr-only">
          {loading
            ? 'Loading suggestions…'
            : open && suggestions.length > 0
              ? `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'} available`
              : ''}
        </span>

        {open && !loading && suggestions.length === 0 ? (
          <div
            role="status"
            aria-live="polite"
            className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-lg"
          >
            No matching GIFs
          </div>
        ) : null}

        {showListbox ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Search suggestions"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {suggestions.map((gif, index) => {
              const category = gif.categoryId ? categories.get(gif.categoryId) : undefined;
              const isActive = index === activeIndex;

              return (
                <li
                  key={gif.id}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(gif)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${
                    isActive ? 'bg-brand-50' : ''
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote hosts aren't finalized, see next.config.mjs */}
                  <img
                    src={gif.thumbnailUrl ?? gif.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-10 w-10 flex-shrink-0 rounded object-cover bg-slate-100"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">
                      {gif.title || 'Untitled GIF'}
                    </span>
                    <span className="block truncate text-xs uppercase tracking-wide text-slate-400">
                      {gif.source}
                      {category ? ` · ${category.name}` : ''}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <button
        type="submit"
        className="shrink-0 rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        Search
      </button>
    </form>
  );
}

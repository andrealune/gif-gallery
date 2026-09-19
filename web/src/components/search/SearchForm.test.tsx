import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, searchGifs: vi.fn(), getCategories: vi.fn() };
});

import { SearchForm } from './SearchForm';
import { ApiError, getCategories, searchGifs, type SearchResults } from '@/lib/api';
import type { CategorySummary, GifSummary } from '@/lib/types';

function makeGif(id: string, overrides: Partial<GifSummary> = {}): GifSummary {
  return {
    id,
    source: 'tenor',
    title: `Gif ${id}`,
    description: null,
    categoryId: 'c1',
    url: `https://example.com/${id}.gif`,
    thumbnailUrl: `https://example.com/${id}-thumb.gif`,
    width: 200,
    height: 200,
    fileSizeBytes: 1000,
    durationMs: 1000,
    mimeType: 'image/gif',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function gifPage(items: GifSummary[], degraded = false): SearchResults<GifSummary> {
  return { items, limit: 6, offset: 0, total: items.length, degraded };
}

function categoriesPage(items: CategorySummary[]) {
  return { items, limit: 100, offset: 0, total: items.length };
}

const category: CategorySummary = {
  id: 'c1',
  name: 'Reactions',
  slug: 'reactions',
  description: null,
  gifCount: 2,
  thumbnailUrl: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

async function typeAndWaitForOptions(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole('combobox'), text);
  return screen.findAllByRole('option');
}

describe('SearchForm', () => {
  beforeEach(() => {
    vi.mocked(searchGifs).mockResolvedValue(gifPage([]));
    vi.mocked(getCategories).mockResolvedValue(categoriesPage([category]));
  });

  afterEach(() => {
    vi.mocked(searchGifs).mockReset();
    vi.mocked(getCategories).mockReset();
    push.mockReset();
  });

  it('has an accessible label and a search role', () => {
    render(<SearchForm />);
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('Search GIFs')).toBeInTheDocument();
  });

  it('pre-fills the input from defaultValue (e.g. the current ?q=)', () => {
    render(<SearchForm defaultValue="dancing cat" />);
    expect(screen.getByRole('combobox', { name: 'Search GIFs' })).toHaveValue('dancing cat');
  });

  it('navigates to /search?q=<value> on submit', async () => {
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(screen.getByRole('combobox'), 'birthday');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(push).toHaveBeenCalledWith('/search?q=birthday');
  });

  it('navigates to plain /search when the query is empty or whitespace', async () => {
    const user = userEvent.setup();
    render(<SearchForm defaultValue="   " />);

    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(push).toHaveBeenCalledWith('/search');
  });

  it('does not fetch suggestions for a single character', async () => {
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(screen.getByRole('combobox'), 'a');
    expect(searchGifs).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(searchGifs).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('fetches and shows debounced suggestions with title, source and category', async () => {
    vi.mocked(searchGifs).mockResolvedValue(gifPage([makeGif('1', { title: 'Dancing cat' })]));
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(screen.getByRole('combobox'), 'da');
    // Not yet - still within the debounce window.
    expect(searchGifs).not.toHaveBeenCalled();

    const option = await screen.findByRole('option');
    expect(searchGifs).toHaveBeenCalledWith('da', { limit: 6 });
    expect(within(option).getByText('Dancing cat')).toBeInTheDocument();
    expect(within(option).getByText('tenor · Reactions')).toBeInTheDocument();
  });

  it('supports arrow-key navigation and Enter to select a suggestion', async () => {
    vi.mocked(searchGifs).mockResolvedValue(
      gifPage([makeGif('1', { title: 'Dancing cat' }), makeGif('2', { title: 'Sleepy cat' })])
    );
    const user = userEvent.setup();
    render(<SearchForm />);
    const input = screen.getByRole('combobox');

    const options = await typeAndWaitForOptions(user, 'cat');
    expect(options).toHaveLength(2);
    const [firstOption, secondOption] = options;
    if (!firstOption || !secondOption) throw new Error('expected two options');

    await user.keyboard('{ArrowDown}');
    expect(firstOption).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', firstOption.id);

    await user.keyboard('{ArrowDown}');
    expect(secondOption).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');

    expect(push).toHaveBeenCalledWith('/search?q=Sleepy%20cat');
    expect(input).toHaveValue('Sleepy cat');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selects a suggestion on click', async () => {
    vi.mocked(searchGifs).mockResolvedValue(gifPage([makeGif('1', { title: 'Birthday balloons' })]));
    const user = userEvent.setup();
    render(<SearchForm />);

    const [option] = await typeAndWaitForOptions(user, 'birth');
    if (!option) throw new Error('expected an option');
    await user.click(option);

    expect(push).toHaveBeenCalledWith('/search?q=Birthday%20balloons');
  });

  it('closes the dropdown on Escape without clearing the typed text', async () => {
    vi.mocked(searchGifs).mockResolvedValue(gifPage([makeGif('1')]));
    const user = userEvent.setup();
    render(<SearchForm />);
    const input = screen.getByRole('combobox');

    await typeAndWaitForOptions(user, 'gif');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('gif');
  });

  it('closes the dropdown when clicking outside the form', async () => {
    vi.mocked(searchGifs).mockResolvedValue(gifPage([makeGif('1')]));
    const user = userEvent.setup();
    render(
      <div>
        <SearchForm />
        <button type="button">outside</button>
      </div>
    );

    await typeAndWaitForOptions(user, 'gif');
    await user.click(screen.getByRole('button', { name: 'outside' }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows "No matching GIFs" when the search returns nothing', async () => {
    vi.mocked(searchGifs).mockResolvedValue(gifPage([]));
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(screen.getByRole('combobox'), 'zzz');

    expect(await screen.findByText('No matching GIFs')).toBeInTheDocument();
  });

  it('degrades to no suggestions (without an error) when the search API is unavailable', async () => {
    vi.mocked(searchGifs).mockRejectedValue(new ApiError('not found', 404));
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(screen.getByRole('combobox'), 'gif');

    expect(await screen.findByText('No matching GIFs')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a basic-search notice above the suggestions when the response is degraded (L42-461/L42-464)', async () => {
    vi.mocked(searchGifs).mockResolvedValue(gifPage([makeGif('1', { title: 'Dancing cat' })], true));
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(screen.getByRole('combobox'), 'da');

    expect(await screen.findByRole('option')).toBeInTheDocument();
    expect(
      screen.getByText('Basic search results — full relevance ranking is temporarily unavailable.')
    ).toBeInTheDocument();
  });

  it('shows the basic-search notice alongside "No matching GIFs" too', async () => {
    vi.mocked(searchGifs).mockResolvedValue(gifPage([], true));
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(screen.getByRole('combobox'), 'zzz');

    expect(await screen.findByText('No matching GIFs')).toBeInTheDocument();
    expect(
      screen.getByText('Basic search results — full relevance ranking is temporarily unavailable.')
    ).toBeInTheDocument();
  });

  it('does not show the basic-search notice for a normal (non-degraded) response', async () => {
    vi.mocked(searchGifs).mockResolvedValue(gifPage([makeGif('1')], false));
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(screen.getByRole('combobox'), 'gif');

    expect(await screen.findByRole('option')).toBeInTheDocument();
    expect(screen.queryByText(/basic search/i)).not.toBeInTheDocument();
  });
});

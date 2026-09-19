import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GifCategoryBrowser } from './GifCategoryBrowser';
import { ApiError } from '@/lib/api';
import type { GifSummary, Page } from '@/lib/types';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, getCategoryGifs: vi.fn() };
});

import { getCategoryGifs } from '@/lib/api';

function makeGif(id: string): GifSummary {
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
  };
}

function page(items: GifSummary[], limit: number, offset: number, total: number): Page<GifSummary> {
  return { items, limit, offset, total };
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = () => [];
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver as unknown as typeof IntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(getCategoryGifs).mockReset();
});

describe('GifCategoryBrowser', () => {
  it('renders the initial page and a "Load more" button when more gifs remain', () => {
    const initial = page([makeGif('1'), makeGif('2')], 2, 0, 5);
    render(<GifCategoryBrowser categorySlug="reactions" initialGifs={initial} />);

    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Load more gifs' })).toBeInTheDocument();
  });

  it('does not render a "Load more" control when the first page already has every gif', () => {
    const initial = page([makeGif('1')], 24, 0, 1);
    render(<GifCategoryBrowser categorySlug="reactions" initialGifs={initial} />);

    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('fetches and appends the next page when "Load more" is activated', async () => {
    const user = userEvent.setup();
    const initial = page([makeGif('1'), makeGif('2')], 2, 0, 4);
    vi.mocked(getCategoryGifs).mockResolvedValueOnce({
      category: { id: 'c1', name: 'Reactions', slug: 'reactions', description: null, gifCount: 4, thumbnailUrl: null, createdAt: '', updatedAt: '' },
      gifs: page([makeGif('3'), makeGif('4')], 2, 2, 4),
    });

    render(<GifCategoryBrowser categorySlug="reactions" initialGifs={initial} />);

    await user.click(screen.getByRole('button', { name: 'Load more gifs' }));

    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(4));
    expect(getCategoryGifs).toHaveBeenCalledWith('reactions', { limit: 2, offset: 2 });
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    expect(screen.getByText(/reached the end/i)).toBeInTheDocument();
  });

  it('loads the next page automatically once the sentinel intersects the viewport', async () => {
    const initial = page([makeGif('1')], 1, 0, 2);
    vi.mocked(getCategoryGifs).mockResolvedValueOnce({
      category: { id: 'c1', name: 'Reactions', slug: 'reactions', description: null, gifCount: 2, thumbnailUrl: null, createdAt: '', updatedAt: '' },
      gifs: page([makeGif('2')], 1, 1, 2),
    });

    render(<GifCategoryBrowser categorySlug="reactions" initialGifs={initial} />);

    const observer = FakeIntersectionObserver.instances[0];
    if (!observer) throw new Error('IntersectionObserver was not constructed');
    act(() => {
      observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
    });

    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
  });

  it('shows an error with a retry button when fetching the next page fails', async () => {
    const user = userEvent.setup();
    const initial = page([makeGif('1')], 1, 0, 2);
    vi.mocked(getCategoryGifs).mockRejectedValueOnce(new ApiError('boom', 500));

    render(<GifCategoryBrowser categorySlug="reactions" initialGifs={initial} />);
    await user.click(screen.getByRole('button', { name: 'Load more gifs' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

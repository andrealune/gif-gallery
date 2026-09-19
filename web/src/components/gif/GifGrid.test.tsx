import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GifGrid } from './GifGrid';
import type { CategorySummary, GifSummary } from '@/lib/types';

function makeGif(id: string, categoryId: string | null): GifSummary {
  return {
    id,
    source: 'tenor',
    title: `Gif ${id}`,
    description: null,
    categoryId,
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

const reactions: CategorySummary = {
  id: 'c1',
  name: 'Reactions',
  slug: 'reactions',
  description: null,
  gifCount: 1,
  thumbnailUrl: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('GifGrid', () => {
  it('renders one card per gif', () => {
    render(<GifGrid gifs={[makeGif('1', null), makeGif('2', null)]} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('looks up and passes each card its category when a categories map is provided', () => {
    render(<GifGrid gifs={[makeGif('1', 'c1')]} categories={new Map([['c1', reactions]])} />);
    expect(screen.getByRole('link', { name: 'Reactions' })).toHaveAttribute('href', '/category/reactions');
  });

  it('renders without a category badge when the gif has no categoryId, or it is not in the map', () => {
    render(<GifGrid gifs={[makeGif('1', null), makeGif('2', 'unknown')]} categories={new Map([['c1', reactions]])} />);
    // Each card still links to its own gif detail page (L42-429) - just no category link.
    expect(screen.queryByRole('link', { name: 'Reactions' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});

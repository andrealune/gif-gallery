import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GifCard } from './GifCard';
import type { GifSummary } from '@/lib/types';

const baseGif: GifSummary = {
  id: 'g1',
  source: 'tenor',
  title: 'Excited clapping',
  description: null,
  categoryId: 'c1',
  url: 'https://example.com/full.gif',
  thumbnailUrl: 'https://example.com/thumb.gif',
  width: 480,
  height: 480,
  fileSizeBytes: 12345,
  durationMs: 2500,
  mimeType: 'image/gif',
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('GifCard', () => {
  it('renders the title as accessible alt text and uses the thumbnail as the image source', () => {
    render(<GifCard gif={baseGif} />);

    const img = screen.getByRole('img', { name: 'Excited clapping' });
    expect(img).toHaveAttribute('src', baseGif.thumbnailUrl);
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('falls back to the full url when there is no thumbnail', () => {
    render(<GifCard gif={{ ...baseGif, thumbnailUrl: null }} />);

    expect(screen.getByRole('img', { name: 'Excited clapping' })).toHaveAttribute('src', baseGif.url);
  });

  it('falls back to a generic alt/title when the gif has no title', () => {
    render(<GifCard gif={{ ...baseGif, title: '' }} />);

    expect(screen.getByRole('img', { name: 'Untitled GIF' })).toBeInTheDocument();
    expect(screen.getByText('Untitled GIF')).toBeInTheDocument();
  });

  it('shows a formatted duration badge when durationMs is present', () => {
    render(<GifCard gif={baseGif} />);
    expect(screen.getByText('2.5s')).toBeInTheDocument();
  });

  it('omits the duration badge when durationMs is null', () => {
    render(<GifCard gif={{ ...baseGif, durationMs: null }} />);
    expect(screen.queryByText(/\ds$/)).not.toBeInTheDocument();
  });

  it('links the whole card to the gif detail page by id when no slug is available', () => {
    render(<GifCard gif={baseGif} />);
    expect(screen.getByRole('link', { name: /Excited clapping/ })).toHaveAttribute('href', '/gif/g1');
  });

  it('links by slug instead of id when a slug is available', () => {
    render(<GifCard gif={{ ...baseGif, slug: 'excited-clapping' }} />);
    expect(screen.getByRole('link', { name: /Excited clapping/ })).toHaveAttribute('href', '/gif/excited-clapping');
  });

  it('omits the category badge (and only links to the gif detail page) when no category is passed', () => {
    render(<GifCard gif={baseGif} />);
    // Just the card's own detail-page link - no separate category link.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('shows the category name as its own link to its page when passed, alongside the detail-page link', () => {
    render(<GifCard gif={baseGif} category={{ name: 'Reactions', slug: 'reactions' }} />);

    const link = screen.getByRole('link', { name: 'Reactions' });
    expect(link).toHaveAttribute('href', '/category/reactions');
    // The category link and the detail-page link are siblings, not nested - nesting an <a>
    // inside another <a> is invalid HTML and would make clicking the category also navigate
    // to the gif detail page.
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Excited clapping/ })).toHaveAttribute('href', '/gif/g1');
  });
});

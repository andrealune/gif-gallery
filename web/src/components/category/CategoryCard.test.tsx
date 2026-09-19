import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CategoryCard } from './CategoryCard';
import type { CategorySummary } from '@/lib/types';

const category: CategorySummary = {
  id: 'c1',
  name: 'Reactions',
  slug: 'reactions',
  description: 'GIFs for reacting to just about anything.',
  gifCount: 42,
  thumbnailUrl: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('CategoryCard', () => {
  it('links to the category browse page by slug', () => {
    render(<CategoryCard category={category} />);
    expect(screen.getByRole('link', { name: /reactions/i })).toHaveAttribute(
      'href',
      '/category/reactions'
    );
  });

  it('shows the gif count, pluralized', () => {
    render(<CategoryCard category={category} />);
    expect(screen.getByText('42 gifs')).toBeInTheDocument();
  });

  it('uses the singular form for exactly one gif', () => {
    render(<CategoryCard category={{ ...category, gifCount: 1 }} />);
    expect(screen.getByText('1 gif')).toBeInTheDocument();
  });

  it('renders the description when present', () => {
    render(<CategoryCard category={category} />);
    expect(screen.getByText(category.description as string)).toBeInTheDocument();
  });

  it('renders the emoji-on-gradient fallback when thumbnailUrl is null', () => {
    render(<CategoryCard category={category} />);
    expect(screen.getByText('🎬')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders the emoji-on-gradient fallback when thumbnailUrl is absent (pre-backend-rollout response)', () => {
    const { thumbnailUrl, ...withoutField } = category;
    render(<CategoryCard category={withoutField as CategorySummary} />);
    expect(screen.getByText('🎬')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders the thumbnail image with an empty alt and lazy loading when available', () => {
    const withThumbnail = { ...category, thumbnailUrl: 'https://cdn.example.com/gif1.gif' };
    render(<CategoryCard category={withThumbnail} />);
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('src')).toBe(withThumbnail.thumbnailUrl);
    expect(screen.queryByText('🎬')).not.toBeInTheDocument();
  });

  it('falls back to the emoji block when the image fails to load', () => {
    const withThumbnail = { ...category, thumbnailUrl: 'https://cdn.example.com/broken.gif' };
    render(<CategoryCard category={withThumbnail} />);
    const img = document.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.getByText('🎬')).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it('keeps the accessible name driven by visible text, not the (decorative, empty-alt) image', () => {
    const withThumbnail = { ...category, thumbnailUrl: 'https://cdn.example.com/gif1.gif' };
    render(<CategoryCard category={withThumbnail} />);
    // The link's accessible name is built from its visible text content (heading, description,
    // gif count) - the same as before this component ever had an <img>. An empty `alt` means the
    // image contributes nothing to it, so the name still starts with the category's visible name.
    expect(screen.getByRole('link', { name: /^Reactions/ })).toBeInTheDocument();
  });
});

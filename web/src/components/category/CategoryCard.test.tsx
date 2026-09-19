import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryCard } from './CategoryCard';
import type { CategorySummary } from '@/lib/types';

const category: CategorySummary = {
  id: 'c1',
  name: 'Reactions',
  slug: 'reactions',
  description: 'GIFs for reacting to just about anything.',
  gifCount: 42,
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
});

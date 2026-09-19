import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('renders nothing when everything fits on one page', () => {
    const { container } = render(<Pagination basePath="/search" limit={24} offset={0} total={10} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('disables "Previous" on the first page and links "Next" to the next offset', () => {
    render(<Pagination basePath="/category/reactions" limit={24} offset={0} total={100} />);

    expect(screen.getByText('← Previous')).not.toHaveAttribute('href');
    expect(screen.getByRole('link', { name: 'Next →' })).toHaveAttribute(
      'href',
      '/category/reactions?offset=24'
    );
    expect(screen.getByText('Page 1 of 5')).toBeInTheDocument();
  });

  it('disables "Next" on the last page and links "Previous" back one page', () => {
    render(<Pagination basePath="/category/reactions" limit={24} offset={96} total={100} />);

    expect(screen.getByText('Next →')).not.toHaveAttribute('href');
    expect(screen.getByRole('link', { name: '← Previous' })).toHaveAttribute(
      'href',
      '/category/reactions?offset=72'
    );
    expect(screen.getByText('Page 5 of 5')).toBeInTheDocument();
  });

  it('preserves extra query params (e.g. the search term) across pages', () => {
    render(
      <Pagination basePath="/search" query={{ q: 'cats' }} limit={24} offset={0} total={50} />
    );

    const next = screen.getByRole('link', { name: 'Next →' });
    expect(next.getAttribute('href')).toBe('/search?q=cats&offset=24');
  });
});

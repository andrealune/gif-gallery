import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

import { SearchForm } from './SearchForm';

describe('SearchForm', () => {
  it('has an accessible label and a search role', () => {
    render(<SearchForm />);
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('Search GIFs')).toBeInTheDocument();
  });

  it('pre-fills the input from defaultValue (e.g. the current ?q=)', () => {
    render(<SearchForm defaultValue="dancing cat" />);
    expect(screen.getByRole('searchbox', { name: 'Search GIFs' })).toHaveValue('dancing cat');
  });

  it('navigates to /search?q=<value> on submit', async () => {
    const user = userEvent.setup();
    render(<SearchForm />);

    await user.type(screen.getByRole('searchbox'), 'birthday');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(push).toHaveBeenCalledWith('/search?q=birthday');
  });

  it('navigates to plain /search when the query is empty or whitespace', async () => {
    const user = userEvent.setup();
    render(<SearchForm defaultValue="   " />);

    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(push).toHaveBeenCalledWith('/search');
  });
});

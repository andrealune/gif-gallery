import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareEmbed } from './ShareEmbed';

const props = {
  pageUrl: 'https://gallery.example/gif/g1',
  assetUrl: 'https://gallery.example/assets/g1.gif',
  title: 'Excited clapping',
  width: 480,
  height: 360,
};

describe('ShareEmbed', () => {
  afterEach(() => {
    // @ts-expect-error - cleaning up the test-only stub between tests.
    delete navigator.share;
  });

  it('does not render a native Share button when navigator.share is unavailable', () => {
    render(<ShareEmbed {...props} />);
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  it('renders a native Share button and invokes navigator.share when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share });
    const user = userEvent.setup();

    render(<ShareEmbed {...props} />);
    await user.click(await screen.findByRole('button', { name: 'Share' }));

    expect(share).toHaveBeenCalledWith({ title: props.title, url: props.pageUrl });
  });

  it('renders social share links pointed at the page url with the title as share text', () => {
    render(<ShareEmbed {...props} />);

    expect(screen.getByRole('link', { name: 'Share on X' })).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent(props.pageUrl))
    );
    expect(screen.getByRole('link', { name: 'Share on Facebook' })).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent(props.pageUrl))
    );
    expect(screen.getByRole('link', { name: 'Share on Reddit' })).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent(props.title))
    );
  });

  it('copies the page url and shows a confirmation, announced to screen readers', async () => {
    const user = userEvent.setup();
    render(<ShareEmbed {...props} />);

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();
    expect(screen.getByText('Link copied to clipboard.')).toBeInTheDocument();
  });

  it('toggles the embed code panel and copies the embed snippet', async () => {
    const user = userEvent.setup();
    render(<ShareEmbed {...props} />);

    const toggle = screen.getByRole('button', { name: 'Embed' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Embed code')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const field = screen.getByLabelText('Embed code') as HTMLTextAreaElement;
    expect(field).toHaveAttribute('readonly');
    expect(field.value).toContain(props.assetUrl);
    expect(field.value).toContain(props.pageUrl);
    expect(field.value).toContain('width="480"');
    expect(field.value).toContain('height="360"');

    await user.click(screen.getByRole('button', { name: 'Copy embed code' }));
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide embed code' }));
    expect(screen.queryByLabelText('Embed code')).not.toBeInTheDocument();
  });

  it('omits width/height from the embed snippet when the gif has no known dimensions', async () => {
    const user = userEvent.setup();
    render(<ShareEmbed {...props} width={null} height={null} />);

    await user.click(screen.getByRole('button', { name: 'Embed' }));

    const field = screen.getByLabelText('Embed code') as HTMLTextAreaElement;
    expect(field.value).not.toContain('width=');
  });

  it('escapes the title used as alt text in the embed snippet', async () => {
    const user = userEvent.setup();
    render(<ShareEmbed {...props} title={'Say "hi" & <wave>'} />);

    await user.click(screen.getByRole('button', { name: 'Embed' }));

    const field = screen.getByLabelText('Embed code') as HTMLTextAreaElement;
    expect(field.value).toContain('alt="Say &quot;hi&quot; &amp; &lt;wave&gt;"');
  });
});

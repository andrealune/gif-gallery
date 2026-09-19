import { describe, expect, it, vi } from 'vitest';
import { TenorImporter } from '../../src/services/tenor';
import type { TenorGif } from '../../src/services/tenor';

function gif(id: string): TenorGif {
  return {
    id,
    title: id,
    contentDescription: '',
    itemUrl: `https://tenor.com/${id}`,
    shareUrl: `https://tenor.com/${id}.gif`,
    created: 0,
    tags: [],
    media: {
      gif: { url: `https://media.tenor.com/${id}.gif`, dims: [1, 1], duration: 0, size: 1 },
      tinygif: { url: `https://media.tenor.com/${id}-tiny.gif`, dims: [1, 1], duration: 0, size: 1 },
    },
    raw: { id },
  };
}

describe('TenorImporter', () => {
  it('follows next tokens, de-duplicates a run, and reports writes', async () => {
    const fetchFeatured = vi
      .fn()
      .mockResolvedValueOnce({ gifs: [gif('a'), gif('b')], next: 'second' })
      .mockResolvedValueOnce({ gifs: [gif('b'), gif('c')], next: null });
    const store = vi.fn().mockResolvedValueOnce('inserted').mockResolvedValueOnce('updated').mockResolvedValueOnce('inserted');
    const summary = await new TenorImporter({ fetchFeatured }, { store }).importFeatured({ pages: 4, limit: 2 });

    expect(fetchFeatured).toHaveBeenNthCalledWith(2, expect.objectContaining({ position: 'second' }));
    expect(store.mock.calls.map((call) => call[0].id)).toEqual(['a', 'b', 'c']);
    expect(summary).toEqual({ fetched: 4, inserted: 2, updated: 1, next: null });
  });

  it('returns a resume cursor after the requested page count', async () => {
    const fetchFeatured = vi.fn().mockResolvedValue({ gifs: [], next: 'resume-here' });
    const summary = await new TenorImporter({ fetchFeatured }, { store: vi.fn() }).importFeatured({ pages: 1 });
    expect(summary.next).toBe('resume-here');
  });
});

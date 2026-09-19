import { describe, expect, it } from 'vitest';
import { absoluteUrl, buildKeywords, gifOgDescription, gifOgImage, gifOgTitle, truncate } from './seo';
import type { GifDetail } from './api';

const baseGif: GifDetail = {
  id: 'g1',
  source: 'tenor',
  title: 'Clapping seal',
  description: null,
  categoryId: '1',
  url: 'https://example.com/g1.gif',
  thumbnailUrl: 'https://example.com/g1-thumb.gif',
  width: 200,
  height: 150,
  fileSizeBytes: 1000,
  durationMs: 2000,
  mimeType: 'image/gif',
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('absoluteUrl', () => {
  it('resolves a relative path against SITE_URL', () => {
    expect(absoluteUrl('/gif/clapping-seal')).toBe('http://localhost:3000/gif/clapping-seal');
  });

  it('leaves an already-absolute URL unaffected', () => {
    expect(absoluteUrl('https://cdn.example.com/x.gif')).toBe('https://cdn.example.com/x.gif');
  });
});

describe('truncate', () => {
  it('returns short text unchanged', () => {
    expect(truncate('short description')).toBe('short description');
  });

  it('cuts long text at a word boundary and adds an ellipsis', () => {
    const long = `${'word '.repeat(40)}tail`;
    const result = truncate(long, 160);
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith('…')).toBe(true);
    expect(result.endsWith(' …')).toBe(false);
  });
});

describe('gifOgTitle', () => {
  it('uses the gif title when present', () => {
    expect(gifOgTitle(baseGif)).toBe('Clapping seal');
  });

  it('falls back for an untitled gif', () => {
    expect(gifOgTitle({ ...baseGif, title: '' })).toBe('Untitled GIF');
  });
});

describe('gifOgDescription', () => {
  it('uses the gif description when present', () => {
    expect(gifOgDescription({ ...baseGif, description: 'A seal clapping happily.' })).toBe(
      'A seal clapping happily.'
    );
  });

  it('falls back to a generic description mentioning the title when none is set', () => {
    const description = gifOgDescription(baseGif);
    expect(description).toContain('Clapping seal');
  });
});

describe('gifOgImage', () => {
  it('prefers the thumbnail and includes known dimensions/alt text', () => {
    expect(gifOgImage(baseGif)).toEqual({
      url: 'https://example.com/g1-thumb.gif',
      width: 200,
      height: 150,
      alt: 'Clapping seal',
    });
  });

  it('falls back to the full gif url when there is no thumbnail', () => {
    const image = gifOgImage({ ...baseGif, thumbnailUrl: null });
    expect(image?.url).toBe('https://example.com/g1.gif');
  });

  it('returns null when there is no image at all', () => {
    expect(gifOgImage({ ...baseGif, thumbnailUrl: null, url: '' })).toBeNull();
  });
});

describe('buildKeywords', () => {
  it('includes the page-specific terms plus the site-wide baseline', () => {
    const keywords = buildKeywords('Cats', 'cats gifs');
    expect(keywords[0]).toBe('cats');
    expect(keywords[1]).toBe('cats gifs');
    expect(keywords).toContain('gif');
    expect(keywords).toContain('gif gallery');
  });

  it('lowercases, trims, and de-duplicates (including against the baseline)', () => {
    const keywords = buildKeywords('  GIF  ', 'Gif', 'Cats');
    expect(keywords.filter((k) => k === 'gif')).toHaveLength(1);
    expect(keywords).toContain('cats');
  });

  it('drops null/undefined/empty terms without producing empty entries', () => {
    const keywords = buildKeywords(undefined, null, '', '   ');
    expect(keywords.every((k) => k.length > 0)).toBe(true);
  });

  it('caps the result at 15 keywords', () => {
    const many = Array.from({ length: 30 }, (_, i) => `term-${i}`);
    expect(buildKeywords(...many).length).toBeLessThanOrEqual(15);
  });
});

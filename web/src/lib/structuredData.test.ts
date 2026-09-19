import { describe, expect, it } from 'vitest';
import { breadcrumbJsonLd, categoryJsonLd, gifJsonLd, serializeJsonLd } from './structuredData';
import type { GifDetail } from './api';
import type { CategorySummary, GifSummary } from './types';

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
  updatedAt: '2024-02-01T00:00:00.000Z',
};

const baseCategory: CategorySummary = {
  id: 'c1',
  name: 'Celebration',
  slug: 'celebration',
  description: 'GIFs for celebrating.',
  gifCount: 2,
  thumbnailUrl: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('gifJsonLd', () => {
  it('describes the gif as an ImageObject/CreativeWork with absolute URLs', () => {
    const data = gifJsonLd(baseGif, '/gif/clapping-seal');

    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toEqual(['ImageObject', 'CreativeWork']);
    expect(data.url).toBe('http://localhost:3000/gif/clapping-seal');
    expect(data['@id']).toBe('http://localhost:3000/gif/clapping-seal');
    expect(data.name).toBe('Clapping seal');
    expect(data.contentUrl).toBe('https://example.com/g1.gif');
    expect(data.thumbnailUrl).toBe('https://example.com/g1-thumb.gif');
    expect(data.width).toBe(200);
    expect(data.height).toBe(150);
    expect(data.encodingFormat).toBe('image/gif');
    expect(data.uploadDate).toBe('2024-01-01T00:00:00.000Z');
    expect(data.dateModified).toBe('2024-02-01T00:00:00.000Z');
    expect(data.isPartOf).toEqual({
      '@type': 'WebSite',
      name: 'GIF Gallery',
      url: 'http://localhost:3000/',
    });
  });

  it('falls back to a generic title/description and omits unknown dimensions', () => {
    const data = gifJsonLd({ ...baseGif, title: '', description: null, width: null, height: null }, '/gif/g1');

    expect(data.name).toBe('Untitled GIF');
    expect(String(data.description)).toContain('This GIF');
    expect(data.width).toBeUndefined();
    expect(data.height).toBeUndefined();
  });
});

describe('breadcrumbJsonLd', () => {
  it('builds a positioned, absolute-URL BreadcrumbList', () => {
    const data = breadcrumbJsonLd([
      { name: 'Home', path: '/' },
      { name: 'Clapping seal', path: '/gif/clapping-seal' },
    ]);

    expect(data['@type']).toBe('BreadcrumbList');
    expect(data.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'http://localhost:3000/' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Clapping seal',
        item: 'http://localhost:3000/gif/clapping-seal',
      },
    ]);
  });
});

describe('categoryJsonLd', () => {
  const gifs: GifSummary[] = [
    { ...baseGif, id: 'g1' },
    { ...baseGif, id: 'g2', title: 'Second gif', thumbnailUrl: null },
  ];

  it('describes the category as a CollectionPage/CreativeWork with an ItemList of ImageObjects', () => {
    const data = categoryJsonLd(baseCategory, gifs, '/category/celebration');

    expect(data['@type']).toEqual(['CollectionPage', 'CreativeWork']);
    expect(data.url).toBe('http://localhost:3000/category/celebration');
    expect(data.name).toBe('Celebration');
    expect(data.description).toBe('GIFs for celebrating.');

    const itemList = data.mainEntity;
    expect(itemList['@type']).toBe('ItemList');
    expect(itemList.numberOfItems).toBe(2);
    expect(itemList.itemListElement).toHaveLength(2);
    expect(itemList.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      url: 'http://localhost:3000/gif/g1',
      item: {
        '@type': 'ImageObject',
        name: 'Clapping seal',
        contentUrl: 'https://example.com/g1.gif',
        thumbnailUrl: 'https://example.com/g1-thumb.gif',
        width: 200,
        height: 150,
        encodingFormat: 'image/gif',
      },
    });
    // No thumbnail for the second gif - the field should be omitted, not `null`/empty.
    expect(itemList.itemListElement[1].item.thumbnailUrl).toBeUndefined();
  });

  it('falls back to a generic description when the category has none', () => {
    const data = categoryJsonLd({ ...baseCategory, description: null }, [], '/category/celebration');
    expect(data.description).toBe('Browse Celebration GIFs.');
    expect(data.mainEntity.numberOfItems).toBe(0);
  });
});

describe('serializeJsonLd', () => {
  it('produces valid, parseable JSON', () => {
    const data = gifJsonLd(baseGif, '/gif/clapping-seal');
    expect(() => JSON.parse(serializeJsonLd(data))).not.toThrow();
    expect(JSON.parse(serializeJsonLd(data))).toEqual(JSON.parse(JSON.stringify(data)));
  });

  it('escapes "<" and ">" so field content can never close or open a <script> tag', () => {
    const malicious = gifJsonLd(
      { ...baseGif, title: '</script><script>alert(1)</script>' },
      '/gif/clapping-seal'
    );
    const serialized = serializeJsonLd(malicious);

    expect(serialized).not.toContain('</script>');
    expect(serialized).not.toContain('<script>');
    expect(serialized).toContain('\\u003cscript\\u003e');
    expect(JSON.parse(serialized).name).toBe('</script><script>alert(1)</script>');
  });

  it('serializes an array of nodes as a JSON array', () => {
    const serialized = serializeJsonLd([
      gifJsonLd(baseGif, '/gif/clapping-seal'),
      breadcrumbJsonLd([{ name: 'Home', path: '/' }]),
    ]);
    const parsed = JSON.parse(serialized);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });
});

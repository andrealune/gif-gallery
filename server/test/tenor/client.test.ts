import { describe, expect, it, vi } from 'vitest';
import { TenorApiError, TenorClient, TenorConfigError, TenorResponseError } from '../../src/services/tenor';

function responseBody(next = 'cursor-2') {
  return {
    next,
    results: [
      {
        id: 'tenor-1',
        title: 'Hello',
        content_description: 'A waving person',
        itemurl: 'https://tenor.com/view/hello-1',
        url: 'https://tenor.com/abc.gif',
        created: 123,
        tags: ['hello'],
        media_formats: {
          gif: { url: 'https://media.tenor.com/full.gif', dims: [480, 270], duration: 1.25, size: 1000 },
          tinygif: { url: 'https://media.tenor.com/tiny.gif', dims: [220, 124], duration: 1.25, size: 200 },
        },
      },
    ],
  };
}

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof TenorClient>[0]> = {}) {
  return new TenorClient({
    apiKey: 'secret-key',
    clientKey: 'gallery',
    fetchImpl,
    maxRetries: 0,
    rateLimiter: { wait: async () => undefined },
    ...extra,
  });
}

describe('TenorClient', () => {
  it('fetches and validates a featured page with an opaque pagination token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(responseBody()), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const page = await client(fetchMock).fetchFeatured({ limit: 12, position: 'opaque + cursor' });

    expect(page.next).toBe('cursor-2');
    expect(page.gifs[0]).toMatchObject({ id: 'tenor-1', contentDescription: 'A waving person' });
    const requested = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requested.pathname).toBe('/v2/featured');
    expect(requested.searchParams.get('pos')).toBe('opaque + cursor');
    expect(requested.searchParams.get('limit')).toBe('12');
    expect(requested.searchParams.get('media_filter')).toBe('gif,tinygif');
    expect(requested.searchParams.get('contentfilter')).toBe('high');
  });

  it('retries 429 using Retry-After and succeeds', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(responseBody('')), { status: 200 }));
    const sleep = vi.fn(async () => undefined);
    const page = await client(fetchMock, { maxRetries: 1, sleep }).fetchFeatured();

    expect(page.next).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('does not retry authentication errors or expose the credential in its error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 }));
    const promise = client(fetchMock, { maxRetries: 3 }).fetchFeatured();
    await expect(promise).rejects.toBeInstanceOf(TenorApiError);
    await expect(promise).rejects.not.toThrow('secret-key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed provider responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [], next: 12 })));
    await expect(client(fetchMock).fetchFeatured()).rejects.toBeInstanceOf(TenorResponseError);
  });

  it('aborts a timed-out request and reports a retryable timeout without leaking its URL', async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })
    );
    const promise = client(fetchMock, { timeoutMs: 1 }).fetchFeatured();
    await expect(promise).rejects.toMatchObject({ status: 408, retryable: true });
    await expect(promise).rejects.not.toThrow('secret-key');
  });

  it('validates credentials and provider limits before calling fetch', async () => {
    expect(() => new TenorClient({ apiKey: '', clientKey: 'gallery' })).toThrow(TenorConfigError);
    expect(() => new TenorClient({ apiKey: 'key', clientKey: 'gallery', baseUrl: 'http://tenor.invalid/v2' })).toThrow(
      'Tenor baseUrl must use the secure tenor.googleapis.com endpoint'
    );
    const fetchMock = vi.fn<typeof fetch>();
    await expect(client(fetchMock).fetchFeatured({ limit: 51 })).rejects.toBeInstanceOf(TenorConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

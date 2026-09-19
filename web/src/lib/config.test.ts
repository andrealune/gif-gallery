import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `resolveApiBaseUrl()` is the split-deployment/preview contract (L42-459, ADR 0001): the browser
 * always uses the public `NEXT_PUBLIC_API_BASE_URL`, while the Next.js server prefers
 * `API_INTERNAL_BASE_URL` when it is set. Each case re-imports the module because both values are
 * read from `process.env`.
 */
async function loadConfig(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      vi.stubEnv(key, '');
      delete process.env[key];
    } else {
      vi.stubEnv(key, value);
    }
  }
  vi.resetModules();
  return import('./config');
}

describe('resolveApiBaseUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the public base URL when no internal override is set', async () => {
    const { resolveApiBaseUrl, API_BASE_URL } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com/api',
      API_INTERNAL_BASE_URL: undefined,
    });

    expect(API_BASE_URL).toBe('https://api.example.com/api');
    expect(resolveApiBaseUrl()).toBe('https://api.example.com/api');
  });

  it('prefers the internal override on the server and strips trailing slashes', async () => {
    const { resolveApiBaseUrl } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: 'https://public.example.com/api',
      API_INTERNAL_BASE_URL: 'http://server:3001/api//',
    });

    const scope = globalThis as { window?: unknown };
    const hadWindow = 'window' in globalThis;
    const { window } = scope;
    // jsdom defines `window`; delete it for this assertion so the module takes the server branch.
    delete scope.window;
    try {
      expect(resolveApiBaseUrl()).toBe('http://server:3001/api');
    } finally {
      if (hadWindow) {
        scope.window = window;
      }
    }
  });

  it('never uses the internal override in the browser', async () => {
    const { resolveApiBaseUrl } = await loadConfig({
      NEXT_PUBLIC_API_BASE_URL: 'https://public.example.com/api',
      API_INTERNAL_BASE_URL: 'http://server:3001/api',
    });

    expect(typeof window).toBe('object');
    expect(resolveApiBaseUrl()).toBe('https://public.example.com/api');
  });
});

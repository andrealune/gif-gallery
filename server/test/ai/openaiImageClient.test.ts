import { describe, expect, it, vi } from 'vitest';
import {
  CostBudgetExceededError,
  OpenAIAuthError,
  OpenAIConfigError,
  OpenAIRateLimitError,
  OpenAIRequestError,
  OpenAIServerError,
  OpenAITimeoutError,
} from '../../src/services/ai/errors';
import { OpenAIImageClient } from '../../src/services/ai/openaiImageClient';
import type { SlidingWindowRateLimiter } from '../../src/services/ai/rateLimiter';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const noopSleep = async (): Promise<void> => {
  /* no-op: tests don't want to wait for real backoff delays */
};

describe('OpenAIImageClient.generateImage', () => {
  it('sends the API key as a Bearer token and returns the generated image', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { created: 123, data: [{ url: 'https://example.com/cat.png', revised_prompt: 'a cat' }] })
      );
    const client = new OpenAIImageClient({ apiKey: 'sk-test', fetchFn, sleep: noopSleep });

    const result = await client.generateImage({ prompt: 'a cat' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string).prompt).toBe('a cat');

    expect(result.images).toEqual([{ url: 'https://example.com/cat.png', b64Json: undefined, revisedPrompt: 'a cat' }]);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('rejects with OpenAIConfigError and never calls the API when the key is missing', async () => {
    const fetchFn = vi.fn();
    const client = new OpenAIImageClient({ apiKey: '', fetchFn, sleep: noopSleep });

    await expect(client.generateImage({ prompt: 'a cat' })).rejects.toBeInstanceOf(OpenAIConfigError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects with OpenAIConfigError for a blank prompt', async () => {
    const fetchFn = vi.fn();
    const client = new OpenAIImageClient({ apiKey: 'sk-test', fetchFn, sleep: noopSleep });

    await expect(client.generateImage({ prompt: '   ' })).rejects.toBeInstanceOf(OpenAIConfigError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('does not retry on 401 (bad credentials)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: 'Invalid API key' } }));
    const client = new OpenAIImageClient({ apiKey: 'sk-bad', fetchFn, sleep: noopSleep, maxRetries: 3 });

    await expect(client.generateImage({ prompt: 'a cat' })).rejects.toBeInstanceOf(OpenAIAuthError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 400 (bad request / content policy)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: 'content policy violation' } }));
    const client = new OpenAIImageClient({ apiKey: 'sk-test', fetchFn, sleep: noopSleep, maxRetries: 3 });

    await expect(client.generateImage({ prompt: 'a cat' })).rejects.toBeInstanceOf(OpenAIRequestError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries after a 429 and succeeds, honoring Retry-After', async () => {
    let calls = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(429, { error: { message: 'rate limited' } }, { 'retry-after': '1' });
      }
      return jsonResponse(200, { data: [{ url: 'https://example.com/ok.png' }] });
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new OpenAIImageClient({ apiKey: 'sk-test', fetchFn, sleep, maxRetries: 2, retryBaseDelayMs: 1 });

    const result = await client.generateImage({ prompt: 'a cat' });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000); // Retry-After: 1 (second) -> 1000ms
    expect(result.images[0].url).toBe('https://example.com/ok.png');
  });

  it('gives up and throws OpenAIRateLimitError once retries are exhausted', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(429, { error: { message: 'rate limited' } }));
    const client = new OpenAIImageClient({ apiKey: 'sk-test', fetchFn, sleep: noopSleep, maxRetries: 2, retryBaseDelayMs: 1 });

    await expect(client.generateImage({ prompt: 'a cat' })).rejects.toBeInstanceOf(OpenAIRateLimitError);
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });

  it('retries on 5xx errors and eventually throws OpenAIServerError', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(503, { error: { message: 'server overloaded' } }));
    const client = new OpenAIImageClient({ apiKey: 'sk-test', fetchFn, sleep: noopSleep, maxRetries: 1, retryBaseDelayMs: 1 });

    await expect(client.generateImage({ prompt: 'a cat' })).rejects.toBeInstanceOf(OpenAIServerError);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws OpenAITimeoutError when the request does not complete in time', async () => {
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );
    const client = new OpenAIImageClient({
      apiKey: 'sk-test',
      fetchFn,
      sleep: noopSleep,
      timeoutMs: 5,
      maxRetries: 0,
    });

    await expect(client.generateImage({ prompt: 'a cat' })).rejects.toBeInstanceOf(OpenAITimeoutError);
  });

  it('rejects with CostBudgetExceededError and never calls the API when over budget', async () => {
    const fetchFn = vi.fn();
    const client = new OpenAIImageClient({
      apiKey: 'sk-test',
      fetchFn,
      sleep: noopSleep,
      costBudgetUsd: 0.01, // less than a single standard image ($0.04)
    });

    await expect(client.generateImage({ prompt: 'a cat' })).rejects.toBeInstanceOf(CostBudgetExceededError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('tracks cumulative cost across multiple successful calls', async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(async () => jsonResponse(200, { data: [{ url: 'https://example.com/x.png' }] }));
    const client = new OpenAIImageClient({ apiKey: 'sk-test', fetchFn, sleep: noopSleep });

    await client.generateImage({ prompt: 'a cat' });
    await client.generateImage({ prompt: 'a dog' });

    const stats = client.getUsageStats();
    expect(stats.totalImages).toBe(2);
    expect(stats.totalCostUsd).toBeCloseTo(0.08);
    expect(stats.history).toHaveLength(2);
  });

  it('waits for the client-side rate limiter before issuing a request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ url: 'https://example.com/x.png' }] }));
    const acquire = vi.fn().mockResolvedValue(undefined);
    const fakeLimiter = { acquire, currentUsage: 0 } as unknown as SlidingWindowRateLimiter;
    const client = new OpenAIImageClient({
      apiKey: 'sk-test',
      fetchFn,
      sleep: noopSleep,
      rateLimiter: fakeLimiter,
    });

    await client.generateImage({ prompt: 'a cat' });

    expect(acquire).toHaveBeenCalledTimes(1);
  });
});

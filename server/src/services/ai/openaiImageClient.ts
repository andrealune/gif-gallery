import { env } from '../../config/env';
import { CostTracker, estimateImageCostUsd } from './costTracker';
import {
  CostBudgetExceededError,
  OpenAIAuthError,
  OpenAIConfigError,
  OpenAIImageClientError,
  OpenAIRateLimitError,
  OpenAIRequestError,
  OpenAIServerError,
  OpenAITimeoutError,
} from './errors';
import { SlidingWindowRateLimiter } from './rateLimiter';

export interface GenerateImageOptions {
  /** Text description of the desired image(s). Required. */
  prompt: string;
  /** Number of images to generate. Defaults to 1. dall-e-3 only supports 1. */
  n?: number;
  /** e.g. "1024x1024", "1024x1792", "1792x1024" (dall-e-3) or "256x256"/"512x512"/"1024x1024" (dall-e-2). */
  size?: string;
  /** dall-e-3 only: "standard" or "hd". */
  quality?: 'standard' | 'hd';
  /** dall-e-3 only: "vivid" or "natural". */
  style?: 'vivid' | 'natural';
  /** Overrides the client's default model for this call. */
  model?: string;
  responseFormat?: 'url' | 'b64_json';
}

export interface GeneratedImage {
  url?: string;
  b64Json?: string;
  revisedPrompt?: string;
}

export interface GenerateImageResult {
  images: GeneratedImage[];
  model: string;
  /** Estimated cost of this call, in USD. */
  costUsd: number;
}

interface OpenAIImagesApiResponseItem {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

interface OpenAIImagesApiResponse {
  created?: number;
  data?: OpenAIImagesApiResponseItem[];
}

interface OpenAIImagesApiErrorBody {
  error?: { message?: string; type?: string; code?: string };
}

export interface OpenAIImageClientOptions {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  defaultSize?: string;
  defaultQuality?: string;
  /** Per-request timeout, in milliseconds. */
  timeoutMs?: number;
  /** Number of retries after the initial attempt for retryable errors. */
  maxRetries?: number;
  /** Base delay for exponential backoff, in milliseconds. */
  retryBaseDelayMs?: number;
  /** Soft spend cap; a request that would exceed it is rejected before being sent. */
  costBudgetUsd?: number;
  rateLimiter?: SlidingWindowRateLimiter;
  costTracker?: CostTracker;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Injectable for tests; defaults to a real `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Client for OpenAI's image generation ("DALL-E") API.
 *
 * Handles:
 *  - Authentication via the `Authorization: Bearer` header.
 *  - Retries with exponential backoff (+ jitter) on rate limiting (429) and
 *    server errors (5xx), honoring the API's `Retry-After` header when present.
 *  - A client-side sliding-window rate limiter, independent of the API's own
 *    limits, to avoid bursting past our account's allowance.
 *  - Request timeouts via `AbortController`.
 *  - Cost tracking/estimation and an optional soft spend budget.
 */
export class OpenAIImageClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly defaultSize: string;
  private readonly defaultQuality: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly costBudgetUsd: number;
  private readonly rateLimiter: SlidingWindowRateLimiter;
  private readonly costTracker: CostTracker;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: OpenAIImageClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.defaultModel = options.defaultModel ?? 'dall-e-3';
    this.defaultSize = options.defaultSize ?? '1024x1024';
    this.defaultQuality = options.defaultQuality ?? 'standard';
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.costBudgetUsd = options.costBudgetUsd ?? Infinity;
    this.rateLimiter = options.rateLimiter ?? new SlidingWindowRateLimiter({ maxRequests: 50, intervalMs: 60000 });
    this.costTracker = options.costTracker ?? new CostTracker();
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Running cost/usage totals for this client instance. */
  getUsageStats(): { totalCostUsd: number; totalImages: number; history: CostTracker['history'] } {
    return {
      totalCostUsd: this.costTracker.totalCostUsd,
      totalImages: this.costTracker.totalImages,
      history: this.costTracker.history,
    };
  }

  async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    if (!this.apiKey) {
      throw new OpenAIConfigError('Missing OpenAI API key. Set OPENAI_API_KEY.');
    }
    if (!options.prompt || !options.prompt.trim()) {
      throw new OpenAIConfigError('A non-empty "prompt" is required.');
    }

    const model = options.model ?? this.defaultModel;
    const size = options.size ?? this.defaultSize;
    const isDalle3 = model === 'dall-e-3';
    const quality = isDalle3 ? options.quality ?? this.defaultQuality : undefined;
    const n = options.n ?? 1;

    const estimatedCost = estimateImageCostUsd(model, size, quality) * n;
    const projectedTotal = this.costTracker.totalCostUsd + estimatedCost;
    if (projectedTotal > this.costBudgetUsd) {
      throw new CostBudgetExceededError(projectedTotal, this.costBudgetUsd);
    }

    await this.rateLimiter.acquire();

    const body: Record<string, unknown> = {
      model,
      prompt: options.prompt,
      size,
      n,
      response_format: options.responseFormat ?? 'url',
    };
    if (quality) {
      body.quality = quality;
    }
    if (isDalle3 && options.style) {
      body.style = options.style;
    }

    const response = await this.requestWithRetry(body);
    const usage = this.costTracker.record(model, size, quality, n);

    const images: GeneratedImage[] = (response.data ?? []).map((item) => ({
      url: item.url,
      b64Json: item.b64_json,
      revisedPrompt: item.revised_prompt,
    }));

    return { images, model, costUsd: usage.costUsd };
  }

  private async requestWithRetry(body: Record<string, unknown>): Promise<OpenAIImagesApiResponse> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.performRequest(body);
      } catch (err) {
        const retryable = this.isRetryable(err);
        if (!retryable || attempt >= this.maxRetries) {
          throw err;
        }
        const delay = this.computeBackoffDelayMs(attempt, err);
        await this.sleep(delay);
        attempt += 1;
      }
    }
  }

  private isRetryable(err: unknown): boolean {
    return err instanceof OpenAIRateLimitError || err instanceof OpenAIServerError || err instanceof OpenAITimeoutError;
  }

  private computeBackoffDelayMs(attempt: number, err: unknown): number {
    if (err instanceof OpenAIRateLimitError && err.retryAfterMs !== undefined) {
      return err.retryAfterMs;
    }
    const exponential = this.retryBaseDelayMs * 2 ** attempt;
    const jitter = Math.random() * this.retryBaseDelayMs;
    return exponential + jitter;
  }

  private async performRequest(body: Record<string, unknown>): Promise<OpenAIImagesApiResponse> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new OpenAITimeoutError(`OpenAI image request timed out after ${this.timeoutMs}ms`);
        }
        throw new OpenAIImageClientError('Network error calling the OpenAI image API', err);
      }

      if (!res.ok) {
        await this.throwForErrorResponse(res);
      }

      return (await res.json()) as OpenAIImagesApiResponse;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async throwForErrorResponse(res: Response): Promise<never> {
    const status = res.status;
    let message = `OpenAI image API request failed with status ${status}`;
    try {
      const payload = (await res.json()) as OpenAIImagesApiErrorBody;
      if (payload?.error?.message) {
        message = payload.error.message;
      }
    } catch {
      // response body wasn't JSON (or was empty) - keep the generic message
    }

    if (status === 401 || status === 403) {
      throw new OpenAIAuthError(message, status);
    }
    if (status === 429) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      throw new OpenAIRateLimitError(message, retryAfterMs !== undefined && !Number.isNaN(retryAfterMs) ? retryAfterMs : undefined);
    }
    if (status >= 500) {
      throw new OpenAIServerError(message, status);
    }
    throw new OpenAIRequestError(message, status);
  }
}

/** Builds the process-wide client from environment configuration (see `src/config/env.ts`). */
export function createOpenAIImageClientFromEnv(): OpenAIImageClient {
  return new OpenAIImageClient({
    apiKey: env.ai.openaiApiKey,
    baseUrl: env.ai.baseUrl,
    defaultModel: env.ai.imageModel,
    defaultSize: env.ai.imageSize,
    defaultQuality: env.ai.imageQuality,
    timeoutMs: env.ai.requestTimeoutMs,
    maxRetries: env.ai.maxRetries,
    retryBaseDelayMs: env.ai.retryBaseDelayMs,
    costBudgetUsd: env.ai.costBudgetUsd,
    rateLimiter: new SlidingWindowRateLimiter({
      maxRequests: env.ai.rateLimitRequestsPerMinute,
      intervalMs: 60000,
    }),
  });
}

/**
 * Shared singleton for the whole process, mirroring the pattern used by the
 * database pool (`src/db/pool.ts`). Feature routes (e.g. the future
 * `/api/generate` endpoint) should import this rather than constructing
 * their own client.
 */
export const openaiImageClient = createOpenAIImageClientFromEnv();

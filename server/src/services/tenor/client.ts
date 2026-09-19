import { TenorApiError, TenorConfigError, TenorResponseError } from './errors';
import { IntervalRateLimiter } from './rateLimiter';
import type { FetchFeaturedOptions, TenorGif, TenorMedia, TenorPage } from './types';

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 30_000;

type Fetch = typeof fetch;

export interface TenorClientOptions {
  apiKey: string;
  clientKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  requestsPerSecond?: number;
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  rateLimiter?: Pick<IntervalRateLimiter, 'wait'>;
}

export class TenorClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: Fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly rateLimiter: Pick<IntervalRateLimiter, 'wait'>;

  constructor(private readonly options: TenorClientOptions) {
    if (!options.apiKey.trim()) throw new TenorConfigError('TENOR_API_KEY is required');
    if (!options.clientKey.trim()) throw new TenorConfigError('TENOR_CLIENT_KEY is required');
    this.baseUrl = (options.baseUrl ?? 'https://tenor.googleapis.com/v2').replace(/\/+$/, '');
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(this.baseUrl);
    } catch {
      throw new TenorConfigError('Tenor baseUrl must be a valid HTTPS URL');
    }
    if (
      parsedBaseUrl.protocol !== 'https:' ||
      parsedBaseUrl.hostname !== 'tenor.googleapis.com' ||
      parsedBaseUrl.port ||
      parsedBaseUrl.username ||
      parsedBaseUrl.password ||
      parsedBaseUrl.search ||
      parsedBaseUrl.hash
    ) {
      throw new TenorConfigError('Tenor baseUrl must use the secure tenor.googleapis.com endpoint');
    }
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    if (!(this.timeoutMs > 0)) throw new TenorConfigError('Tenor timeoutMs must be greater than zero');
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) {
      throw new TenorConfigError('Tenor maxRetries must be a non-negative integer');
    }
    if (!(this.retryBaseDelayMs >= 0)) {
      throw new TenorConfigError('Tenor retryBaseDelayMs must be non-negative');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    const rps = options.requestsPerSecond ?? 1;
    if (!(rps > 0)) throw new TenorConfigError('Tenor requestsPerSecond must be greater than zero');
    this.rateLimiter = options.rateLimiter ?? new IntervalRateLimiter(Math.ceil(1000 / rps), this.sleep);
  }

  async fetchFeatured(options: FetchFeaturedOptions = {}): Promise<TenorPage> {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new TenorConfigError('Tenor featured limit must be an integer from 1 to 50');
    }

    const url = new URL(`${this.baseUrl}/featured`);
    url.searchParams.set('key', this.options.apiKey);
    url.searchParams.set('client_key', this.options.clientKey);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('media_filter', 'gif,tinygif');
    url.searchParams.set('contentfilter', options.contentFilter ?? 'high');
    url.searchParams.set('country', options.country ?? 'US');
    url.searchParams.set('locale', options.locale ?? 'en_US');
    if (options.position) url.searchParams.set('pos', options.position);

    const body = await this.request(url);
    return parsePage(body);
  }

  private async request(url: URL): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) await this.sleep(this.retryDelay(attempt, lastError));
      await this.rateLimiter.wait();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
          throw new TenorApiError(
            response.status,
            `Tenor API request failed with HTTP ${response.status}`,
            RETRYABLE_STATUSES.has(response.status),
            retryAfterMs
          );
        }
        try {
          return await response.json();
        } catch (error) {
          throw new TenorResponseError('Tenor API returned invalid JSON', { cause: error });
        }
      } catch (error) {
        lastError = normalizeRequestError(error);
        if (attempt >= this.maxRetries || !isRetryable(lastError)) throw lastError;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  private retryDelay(attempt: number, error: unknown): number {
    if (error instanceof TenorApiError && error.retryAfterMs !== undefined) {
      return Math.min(error.retryAfterMs, MAX_RETRY_DELAY_MS);
    }
    const exponential = this.retryBaseDelayMs * 2 ** (attempt - 1);
    return Math.min(Math.round(exponential * (0.5 + this.random() * 0.5)), MAX_RETRY_DELAY_MS);
  }
}

function normalizeRequestError(error: unknown): unknown {
  if (error instanceof TenorApiError || error instanceof TenorResponseError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new TenorApiError(408, 'Tenor API request timed out', true);
  }
  if (error instanceof TypeError) {
    return new TenorApiError(503, 'Tenor API network request failed', true);
  }
  return error;
}

function isRetryable(error: unknown): boolean {
  return error instanceof TenorApiError && error.retryable;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function parsePage(value: unknown): TenorPage {
  const root = asObject(value, 'response');
  if (!Array.isArray(root.results) || typeof root.next !== 'string') {
    throw new TenorResponseError('Tenor API response is missing results or next');
  }
  return { gifs: root.results.map((item, index) => parseGif(item, index)), next: root.next || null };
}

function parseGif(value: unknown, index: number): TenorGif {
  const item = asObject(value, `results[${index}]`);
  const formats = asObject(item.media_formats, `results[${index}].media_formats`);
  return {
    id: requiredString(item.id, `results[${index}].id`),
    title: optionalString(item.title),
    contentDescription: optionalString(item.content_description),
    itemUrl: requiredHttpUrl(item.itemurl, `results[${index}].itemurl`),
    shareUrl: requiredHttpUrl(item.url, `results[${index}].url`),
    created: optionalNumber(item.created),
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    media: {
      gif: parseMedia(formats.gif, `results[${index}].media_formats.gif`),
      tinygif: parseMedia(formats.tinygif, `results[${index}].media_formats.tinygif`),
    },
    raw: item,
  };
}

function parseMedia(value: unknown, path: string): TenorMedia {
  const media = asObject(value, path);
  if (!Array.isArray(media.dims) || media.dims.length !== 2) {
    throw new TenorResponseError(`Tenor API response has invalid ${path}.dims`);
  }
  const width = positiveNumber(media.dims[0], `${path}.dims[0]`);
  const height = positiveNumber(media.dims[1], `${path}.dims[1]`);
  return {
    url: requiredHttpUrl(media.url, `${path}.url`),
    dims: [width, height],
    duration: nonNegativeNumber(media.duration, `${path}.duration`),
    size: nonNegativeNumber(media.size, `${path}.size`),
  };
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TenorResponseError(`Tenor API response has invalid ${path}`);
  }
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value) throw new TenorResponseError(`Tenor API response has invalid ${path}`);
  return value;
}
function optionalString(value: unknown): string { return typeof value === 'string' ? value : ''; }
function optionalNumber(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function positiveNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new TenorResponseError(`Tenor API response has invalid ${path}`);
  return value;
}
function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TenorResponseError(`Tenor API response has invalid ${path}`);
  return value;
}
function requiredHttpUrl(value: unknown, path: string): string {
  const stringValue = requiredString(value, path);
  try {
    const parsed = new URL(stringValue);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('invalid protocol');
    return stringValue;
  } catch {
    throw new TenorResponseError(`Tenor API response has invalid ${path}`);
  }
}

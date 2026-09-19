import dotenv from 'dotenv';
import path from 'path';

// Load .env file (no-op in production if the file is absent; real values
// are expected to come from the process environment in that case).
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function requiredInProduction(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? '';
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function toFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
  isTest: optional('NODE_ENV', 'development') === 'test',
  port: toInt(process.env.PORT, 3001),
  corsOrigin: optional('CORS_ORIGIN', '*'),

  db: {
    connectionString: optional('DATABASE_URL'),
    host: optional('DB_HOST', 'localhost'),
    port: toInt(process.env.DB_PORT, 5432),
    database: optional('DB_NAME', 'gif_gallery'),
    user: optional('DB_USER', 'postgres'),
    password: optional('DB_PASSWORD', ''),
    ssl: toBool(process.env.DB_SSL, false),
    poolMax: toInt(process.env.DB_POOL_MAX, 10),
    idleTimeoutMillis: toInt(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: toInt(process.env.DB_CONNECTION_TIMEOUT_MS, 5000),
  },

  tenor: {
    // Tenor API v2. Existing client credentials are required; Tenor stopped
    // accepting new API clients in January 2026 and will shut down June 30, 2026.
    apiKey: optional('TENOR_API_KEY'),
    clientKey: optional('TENOR_CLIENT_KEY', 'gif_gallery'),
    requestTimeoutMs: toInt(process.env.TENOR_REQUEST_TIMEOUT_MS, 5000),
    maxRetries: toInt(process.env.TENOR_MAX_RETRIES, 3),
    retryBaseDelayMs: toInt(process.env.TENOR_RETRY_BASE_DELAY_MS, 500),
    requestsPerSecond: toFloat(process.env.TENOR_REQUESTS_PER_SECOND, 1),
  },

  ai: {
    // OpenAI (DALL-E) image generation client - see src/services/ai.
    openaiApiKey: requiredInProduction('OPENAI_API_KEY'),
    baseUrl: optional('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    imageModel: optional('OPENAI_IMAGE_MODEL', 'dall-e-3'),
    imageSize: optional('OPENAI_IMAGE_SIZE', '1024x1024'),
    imageQuality: optional('OPENAI_IMAGE_QUALITY', 'standard'),
    requestTimeoutMs: toInt(process.env.OPENAI_REQUEST_TIMEOUT_MS, 60000),
    maxRetries: toInt(process.env.OPENAI_MAX_RETRIES, 3),
    retryBaseDelayMs: toInt(process.env.OPENAI_RETRY_BASE_DELAY_MS, 500),
    rateLimitRequestsPerMinute: toInt(process.env.OPENAI_RATE_LIMIT_RPM, 50),
    // Soft spend cap enforced client-side before issuing a request. Unset (or
    // <= 0) means "no cap" - cost is still tracked either way.
    costBudgetUsd: toFloat(process.env.OPENAI_COST_BUDGET_USD, Infinity),
  },

  gif: {
    // Image-to-GIF conversion pipeline - see src/services/gif (L42-422).
    // Shells out to `ffmpeg` (and `ffprobe`, for best-effort result
    // metadata); both must be on PATH unless overridden here.
    ffmpegPath: optional('FFMPEG_PATH', 'ffmpeg'),
    ffprobePath: optional('FFPROBE_PATH', 'ffprobe'),
    // '' (default) means "use os.tmpdir()".
    tmpDir: optional('GIF_TMP_DIR', ''),
    defaultWidth: toInt(process.env.GIF_DEFAULT_WIDTH, 480),
    // Unset by default: multi-frame conversions then preserve the source
    // aspect ratio; the single-image Ken Burns path falls back to a square
    // frame (height = width) since ffmpeg's zoompan filter needs both axes.
    defaultHeight: toOptionalInt(process.env.GIF_DEFAULT_HEIGHT),
    defaultFps: toInt(process.env.GIF_DEFAULT_FPS, 10),
    // GIF loop count: 0 = loop forever, -1 = play once, N > 0 = loop N extra times.
    defaultLoop: toInt(process.env.GIF_DEFAULT_LOOP, 0),
    defaultDither: optional('GIF_DEFAULT_DITHER', 'sierra2_4a'),
    // Ken Burns (pan/zoom) animation applied to single still images.
    kenBurnsZoom: toFloat(process.env.GIF_KEN_BURNS_ZOOM, 1.15),
    kenBurnsDurationMs: toInt(process.env.GIF_KEN_BURNS_DURATION_MS, 3000),
    conversionTimeoutMs: toInt(process.env.GIF_CONVERSION_TIMEOUT_MS, 30000),
    maxInputBytes: toInt(process.env.GIF_MAX_INPUT_BYTES, 25 * 1024 * 1024),
    // Max number of conversions `convertBatch` runs at once by default.
    batchConcurrency: toInt(process.env.GIF_BATCH_CONCURRENCY, 3),
  },

  storage: {
    // Minimal local-disk provider is implemented by src/services/storage
    // (L42-424) so the batch scheduler can persist a gif end-to-end today.
    // A full multi-provider abstraction (S3, CDN URLs, etc.) is L42-425's job.
    provider: optional('STORAGE_PROVIDER', 'local'),
    localDir: optional('STORAGE_LOCAL_DIR', './storage'),
    s3Bucket: optional('S3_BUCKET'),
    s3Region: optional('S3_REGION'),
    s3AccessKeyId: optional('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: optional('S3_SECRET_ACCESS_KEY'),
  },

  seo: {
    // Canonical public origin the site is served from (no trailing slash).
    // Used to build absolute <loc> URLs in sitemap.xml and the Sitemap:
    // directive in robots.txt (L42-433). Must match the public frontend
    // origin in production, e.g. https://www.example.com.
    siteUrl: optional('SITE_URL', 'http://localhost:3000').replace(/\/+$/, ''),
  },

  generation: {
    // Batch generation scheduler (L42-424): periodically generates new GIFs
    // from docs/specs/ai-generation-prompts-spec.md's category->prompt
    // mapping (`generation_prompts`), via src/services/ai + src/services/gif,
    // and records the outcome in `generation_attempts`.
    // Off by default so importing this module never has a side effect in
    // tests/dev; set explicitly (or call startGenerationScheduler() directly)
    // to run it.
    enabled: toBool(process.env.GENERATION_SCHEDULER_ENABLED, false),
    // Standard 5-field cron expression. Default: once a day at 03:00.
    // Use e.g. '0 3 * * 1' for "every Monday at 03:00" (weekly).
    cronSchedule: optional('GENERATION_CRON_SCHEDULE', '0 3 * * *'),
    timezone: optional('GENERATION_TIMEZONE', 'UTC'),
    // Caps how many categories a single batch run generates for (each
    // category gets at most one attempt per run). 0 = no cap, i.e. every
    // category that currently has at least one active prompt. Feeds gap G6
    // (cost/quota) from the prompts spec - keep this and OPENAI_COST_BUDGET_USD
    // in mind together when sizing a run.
    maxCategoriesPerRun: toInt(process.env.GENERATION_MAX_CATEGORIES_PER_RUN, 0),
    // Also runs one batch immediately on process startup, in addition to the
    // cron schedule. Useful for manually triggering a run or smoke-testing in
    // a deploy; leave off in normal operation so restarts don't cause an
    // unplanned extra run.
    runOnStart: toBool(process.env.GENERATION_RUN_ON_START, false),
  },
};

export type Env = typeof env;

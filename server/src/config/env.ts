import dotenv from 'dotenv';
import path from 'path';

// Load .env file (no-op in production if the file is absent; real values
// are expected to come from the process environment in that case).
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

// Required in production only when the feature that actually consumes
// `name` is enabled (e.g. the batch generation scheduler below, gated by
// GENERATION_SCHEDULER_ENABLED, default false). Booting the whole server
// should never depend on credentials for a feature that is off.
function requiredInProductionWhen(name: string, enabled: boolean): string {
  const value = process.env[name];
  if (!value && enabled && process.env.NODE_ENV === 'production') {
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
    // Only the batch generation scheduler (src/services/generation, gated
    // by GENERATION_SCHEDULER_ENABLED below) reads this key today - no HTTP
    // route triggers AI generation on demand - so only require it in
    // production when that scheduler is actually turned on. Requiring it
    // unconditionally would fail the whole server to boot (including in
    // deployments/previews that never enable AI generation).
    openaiApiKey: requiredInProductionWhen(
      'OPENAI_API_KEY',
      toBool(process.env.GENERATION_SCHEDULER_ENABLED, false),
    ),
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

    // IndexNow (https://www.indexnow.org/) lets us push new/changed URLs
    // straight to Bing/Yandex/Seznam instead of waiting for them to
    // recrawl (L42-435 - "submit to search engines"). Get a key from
    // https://www.bing.com/indexnow (or generate any hex string and use the
    // same one everywhere) and set it here. Unset by default: the key file
    // route (src/routes/indexnow.ts) and `npm run seo:submit-indexnow`
    // (src/seo/submitIndexNow.ts) both no-op without it, so this is safe to
    // leave off until someone actually registers a key.
    indexNowKey: optional('INDEXNOW_KEY'),
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

  elasticsearch: {
    // GIF search cluster - see src/search and docs/elasticsearch.md (L42-418).
    // Local dev: docker-compose.yml starts a single-node cluster at this
    // default. Cloud/production: point at the managed endpoint and set
    // ELASTICSEARCH_API_KEY (preferred) or USERNAME/PASSWORD.
    node: optional('ELASTICSEARCH_NODE', 'http://localhost:9200'),
    // Alias the application queries/writes through; the pipeline manages the
    // real versioned indices (gifs_v1, gifs_v2, ...) behind it.
    indexAlias: optional('ELASTICSEARCH_GIFS_INDEX', 'gifs'),
    apiKey: optional('ELASTICSEARCH_API_KEY'),
    username: optional('ELASTICSEARCH_USERNAME'),
    password: optional('ELASTICSEARCH_PASSWORD'),
    tlsRejectUnauthorized: toBool(process.env.ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED, true),
    requestTimeoutMs: toInt(process.env.ELASTICSEARCH_REQUEST_TIMEOUT_MS, 10000),
    maxRetries: toInt(process.env.ELASTICSEARCH_MAX_RETRIES, 3),
    // A single shard comfortably covers the 10k-100k document target (see
    // gifsIndex.ts); replicas default to 0 for a single-node local cluster
    // and should be raised (>=1) in production for availability.
    indexShards: toInt(process.env.ELASTICSEARCH_INDEX_SHARDS, 1),
    indexReplicas: toInt(process.env.ELASTICSEARCH_INDEX_REPLICAS, 0),
    // Rows fetched from Postgres per page during a reindex (search:reindex).
    reindexBatchSize: toInt(process.env.ELASTICSEARCH_REINDEX_BATCH_SIZE, 500),

    // Incremental create/update/delete sync job - see src/search/syncJob.ts
    // (L42-419). Runs inline in the API process by default; set to false to
    // run it only via the standalone `npm run search:sync` worker instead.
    syncEnabled: toBool(process.env.ELASTICSEARCH_SYNC_ENABLED, true),
    // How long to wait between polls once a poll comes back with nothing new.
    syncIntervalMs: toInt(process.env.ELASTICSEARCH_SYNC_INTERVAL_MS, 5000),
    // Changed rows fetched from Postgres per page while syncing.
    syncBatchSize: toInt(process.env.ELASTICSEARCH_SYNC_BATCH_SIZE, 200),
    // On startup, the job's cursor starts this far in the past (rather than
    // at "now") so changes racing with process startup/restart are still
    // picked up; re-processing a row already synced is harmless (idempotent
    // upsert/delete by id).
    syncStartupOverlapMs: toInt(process.env.ELASTICSEARCH_SYNC_STARTUP_OVERLAP_MS, 60000),
  },
};

export type Env = typeof env;

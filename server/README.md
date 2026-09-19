# gif-gallery server

Backend API for the AI-powered GIF gallery website (Node.js + TypeScript + Express).

## Stack

- Node.js 18+, TypeScript
- Express for HTTP routing/middleware
- `pg` with a connection pool for PostgreSQL access
- `helmet`, `cors`, `morgan` for baseline HTTP hardening/logging
- `ffmpeg`/`ffprobe` (external binaries) for the image-to-GIF conversion pipeline
- `vitest` + `supertest` for tests

## Project structure

```
server/
  migrations/    SQL schema migrations (NNNN_name.up.sql / .down.sql pairs)
  src/
    config/      environment variable loading & validation (env.ts)
    db/          database connection pool (pool.ts) and migration runner (migrate.ts)
    middleware/  Express middleware (error handling, etc.)
    routes/      route definitions, mounted under /api
    services/
      ai/        OpenAI (DALL-E) image generation client, retry/rate-limit/cost tracking
      gif/       image-to-GIF conversion pipeline (ffmpeg), incl. batch conversion
    app.ts       Express app factory (used by tests and index.ts)
    index.ts     process entry point: starts the HTTP server
  test/          vitest test suites
  docs/          architecture/data documentation (database-schema.md)
  .env.example   documented list of required/optional env vars
```

## Getting started

```bash
cd server
cp .env.example .env   # then fill in real values (DB credentials, API keys, ...)
npm install
npm run dev             # starts on http://localhost:3001 with live reload
```

Other scripts:

- `npm run build` – type-check and compile to `dist/`
- `npm start` – run the compiled server (`dist/index.js`)
- `npm test` – run the test suite
- `npm run lint` – lint the codebase
- `npm run migrate:status` – list applied/pending schema migrations
- `npm run migrate:up` – apply all pending schema migrations
- `npm run migrate:down [-- --step N]` – roll back the most recent migration (or the last N)

**System dependency:** the image-to-GIF pipeline (`src/services/gif`) shells out to `ffmpeg`/`ffprobe`.
Install them locally (e.g. `apt-get install ffmpeg` / `brew install ffmpeg`) before running
`test/gif/*.test.ts` or anything that imports `src/services/gif`; those tests skip themselves with a
console warning (instead of failing) if the binaries aren't on `PATH`.

## Environment variables

See `.env.example` for the full list. Highlights:

- `PORT` – HTTP port (default `3001`)
- `CORS_ORIGIN` – allowed origin(s) for the frontend, comma-separated (or `*`)
- `DATABASE_URL` – full Postgres connection string, or set `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` individually
- `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS` – connection pool tuning
- `OPENAI_API_KEY` – used by the AI image generation client (see below); required in production
- `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE`, `OPENAI_IMAGE_QUALITY` – defaults for generated images
- `OPENAI_REQUEST_TIMEOUT_MS`, `OPENAI_MAX_RETRIES`, `OPENAI_RETRY_BASE_DELAY_MS` – retry/timeout tuning
- `OPENAI_RATE_LIMIT_RPM` – client-side cap on outgoing requests per minute
- `OPENAI_COST_BUDGET_USD` – optional soft spend cap enforced before a request is sent
- `FFMPEG_PATH`, `FFPROBE_PATH` – override if the binaries aren't plain `ffmpeg`/`ffprobe` on `PATH`
- `GIF_DEFAULT_WIDTH`, `GIF_DEFAULT_HEIGHT`, `GIF_DEFAULT_FPS`, `GIF_DEFAULT_LOOP`, `GIF_DEFAULT_DITHER` –
  defaults for the image-to-GIF conversion pipeline (see below)
- `GIF_KEN_BURNS_ZOOM`, `GIF_KEN_BURNS_DURATION_MS` – single-image pan/zoom animation tuning
- `GIF_CONVERSION_TIMEOUT_MS`, `GIF_MAX_INPUT_BYTES`, `GIF_BATCH_CONCURRENCY` – pipeline safety/performance limits
- `STORAGE_PROVIDER`, `STORAGE_LOCAL_DIR`, `S3_*` – reserved for the file storage setup (see L42-425)

## Health checks

- `GET /api/health` – process liveness (always 200 while the server is up)
- `GET /api/health/db` – verifies the database pool can reach Postgres (200/503)

## Database

The database schema itself is defined by a separate task (L42-414, database engineer). This task only
establishes the pooled connection (`src/db/pool.ts`) that later migrations/queries build on.

## AI image generation client (`src/services/ai`)

`openaiImageClient` (exported from `src/services/ai`) wraps OpenAI's image generation
("DALL-E") API for use by future routes/jobs (e.g. the `/api/generate` endpoint):

```ts
import { openaiImageClient } from './services/ai';

const result = await openaiImageClient.generateImage({ prompt: 'a corgi skateboarding, cartoon style' });
// result.images[0].url, result.costUsd, ...
```

It handles, out of the box:

- **Authentication** – sends `OPENAI_API_KEY` as a `Bearer` token; throws `OpenAIConfigError` up front
  if the key (or the prompt) is missing, without making a network call.
- **Retries** – exponential backoff with jitter on HTTP 429 and 5xx responses (and on timeouts),
  honoring the API's `Retry-After` header when present. Non-retryable errors (401/403 auth failures,
  other 4xx like invalid prompts/content-policy violations) fail immediately as
  `OpenAIAuthError`/`OpenAIRequestError`. Tunable via `OPENAI_MAX_RETRIES` / `OPENAI_RETRY_BASE_DELAY_MS`.
- **Timeouts** – each attempt is aborted after `OPENAI_REQUEST_TIMEOUT_MS` via `AbortController`,
  surfaced as `OpenAITimeoutError` (itself retried).
- **Client-side rate limiting** – a sliding-window limiter (`OPENAI_RATE_LIMIT_RPM`) throttles our own
  outgoing request rate, independent of whatever OpenAI enforces for the account/tier.
- **Cost tracking** – every successful call is priced from a small per-model/size/quality table and
  accumulated in-memory (`client.getUsageStats()`); an optional soft budget (`OPENAI_COST_BUDGET_USD`)
  rejects a request with `CostBudgetExceededError` *before* it is sent if it would exceed the cap.

See `src/services/ai/*.ts` and `test/ai/*.test.ts` for the full behavior and error types
(`OpenAIConfigError`, `OpenAIAuthError`, `OpenAIRateLimitError`, `OpenAIRequestError`,
`OpenAIServerError`, `OpenAITimeoutError`, `CostBudgetExceededError`). No HTTP route is wired up yet -
this task only sets up the client itself; wiring a `/api/generate` endpoint on top of it is a
separate, later task.

## Image-to-GIF conversion pipeline (`src/services/gif`)

`gifConverter` (exported from `src/services/gif`) turns one or more still images - e.g. straight off
`openaiImageClient.generateImage()` - into an animated GIF by shelling out to `ffmpeg`:

```ts
import { gifConverter, imageInputFromGeneratedImage } from './services/gif';

const generated = await openaiImageClient.generateImage({ prompt: 'a corgi skateboarding' });
const { gif, width, height, frameCount } = await gifConverter.convert(
  [imageInputFromGeneratedImage(generated.images[0])],
  { width: 480 }
);
// gif is a Buffer of GIF89a bytes, ready to hand to the file storage layer (L42-425).
```

Two conversion modes, chosen automatically from the number of frames given:

- **Multiple frames** are assembled in order into one animated GIF (via ffmpeg's `concat` demuxer),
  each shown for an equal (`fps`) or individually-specified (`frameDurationsMs`) duration.
- **A single frame** gets a short synthetic pan/zoom ("Ken Burns") animation via ffmpeg's `zoompan`
  filter by default - useful since an AI image generator produces one static image per call, not a
  ready-made animation. Pass `kenBurns: false` for a plain still frame instead.

Every input can be a `Buffer`, a base64 string (bare or `data:` URL - as returned by
`b64_json`/`GeneratedImage.b64Json`), a local file path, or a remote URL (fetched, size- and
time-bounded); see `imageInputFrom*` in `src/services/gif/types.ts`. Every conversion re-encodes
through ffmpeg's two-pass palette filters (`palettegen`/`paletteuse`) for noticeably better color
quality than the GIF encoder's flat default palette.

**Batch conversion:** `gifConverter.convertBatch(jobs)` runs several independent conversions (each
its own `{ id, frames, options }` job) with bounded concurrency (`GIF_BATCH_CONCURRENCY`, default 3).
One job failing (bad input, ffmpeg crash, timeout, ...) is reported as its own
`{ status: 'rejected', error }` outcome and does **not** abort the rest of the batch:

```ts
const summary = await gifConverter.convertBatch([
  { id: 'a', frames: [imageInputFromUrl(urlA)] },
  { id: 'b', frames: [imageInputFromUrl(urlB)] },
]);
// summary.succeeded, summary.failed, summary.results[i] -> { id, status, result | error }
```

See `src/services/gif/*.ts` and `test/gif/*.test.ts` for the full behavior and error types
(`InvalidImageInputError`, `InvalidOptionsError`, `ImageFetchError`, `FfmpegNotFoundError`,
`FfmpegExecutionError`, `GifConversionTimeoutError`). No HTTP route or job queue is wired up yet -
this task only builds the conversion pipeline itself; the batch generation scheduler that drives it
end-to-end (generate → convert → store) is a separate, later task (L42-424).

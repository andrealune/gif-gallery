# gif-gallery server

Backend API for the AI-powered GIF gallery website (Node.js + TypeScript + Express).

## Stack

- Node.js 18+, TypeScript
- Express for HTTP routing/middleware
- `pg` with a connection pool for PostgreSQL access
- `helmet`, `cors`, `morgan` for baseline HTTP hardening/logging
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
      ai/          OpenAI (DALL-E) image generation client, retry/rate-limit/cost tracking
      categories/  category listing/metadata + gifs-by-category reads (CategoryRepository)
    utils/       shared request helpers (pagination.ts)
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
- `STORAGE_PROVIDER`, `STORAGE_LOCAL_DIR`, `S3_*` – reserved for the file storage setup (see L42-425)

## Health checks

- `GET /api/health` – process liveness (always 200 while the server is up)
- `GET /api/health/db` – verifies the database pool can reach Postgres (200/503)

## Categories (`src/routes/categories.ts`, `src/services/categories`)

Read-only endpoints over the `categories` table and the gifs assigned to each one (L42-417).
A gif only counts/appears here while `status = 'active'` (matches the `gifs_active_created_at_idx`
partial index – archived/flagged/soft-deleted gifs are excluded from public listings).

- `GET /api/categories?limit=&offset=` – lists every category (alphabetical by name) with its
  `gifCount` metadata. `{ data: Category[], pagination: { limit, offset, total } }`.
- `GET /api/categories/:idOrSlug` – a single category (looked up by UUID `id` or by `slug`) plus
  its `gifCount`. `{ data: Category }`, 404 if not found.
- `GET /api/categories/:idOrSlug/gifs?limit=&offset=` – gifs in that category, newest first.
  `{ data: Gif[], category: Category, pagination: { limit, offset, total } }`, 404 if the category
  doesn't exist.

`limit`/`offset` (shared by both paginated routes via `src/utils/pagination.ts`) must be
non-negative integers; `limit` defaults to 20 (50 for the category list) and is capped at 100.
An invalid value (non-numeric, negative, fractional, or over the cap) is rejected with `400`
rather than silently clamped.

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

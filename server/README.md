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
- `OPENAI_API_KEY` – used by the AI image/GIF generation client (see L42-421); required in production
- `STORAGE_PROVIDER`, `STORAGE_LOCAL_DIR`, `S3_*` – reserved for the file storage setup (see L42-425)

## Health checks

- `GET /api/health` – process liveness (always 200 while the server is up)
- `GET /api/health/db` – verifies the database pool can reach Postgres (200/503)

## Database

The schema is defined by versioned SQL migrations in `migrations/` and applied with the runner in
`src/db/migrate.ts` (see `npm run migrate:*` above). Full design rationale, the entity-relationship
overview, indexing strategy and data-retention plan live in `docs/database-schema.md` -- read that
before writing queries against `gifs`, `categories`, `tags`, `gif_tags` or `third_party_references`.

Quick start against a local Postgres 13+ instance:

```bash
createdb gif_gallery   # or: docker run -e POSTGRES_DB=gif_gallery ... postgres:16
npm run migrate:up
npm run migrate:status
```

`src/db/pool.ts` provides the pooled runtime connection that routes/services use; it is unrelated to
the migration runner above, which opens its own single connection so DDL runs outside the app's pool.

Every migration file's header states its locking behaviour, rollback path and data impact -- read
`.down.sql` before running `migrate:down` against any database that already has real data in it, since
several down-migrations are destructive by design (they drop the tables/rows the matching up-migration
created).

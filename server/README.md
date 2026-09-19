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
  src/
    config/      environment variable loading & validation (env.ts)
    db/          database connection pool (pool.ts)
    middleware/  Express middleware (error handling, etc.)
    routes/      route definitions, mounted under /api
    app.ts       Express app factory (used by tests and index.ts)
    index.ts     process entry point: starts the HTTP server
  test/          vitest test suites
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

The database schema itself is defined by a separate task (L42-414, database engineer). This task only
establishes the pooled connection (`src/db/pool.ts`) that later migrations/queries build on.

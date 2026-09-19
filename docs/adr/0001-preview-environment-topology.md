# ADR 0001 - Preview environment topology for `web` + `server` (+ Postgres)

- Status: Accepted
- Date: 2026-06-05
- Deciders: Principal Software Architect (author); reviewers: Database Engineer, CTO
- Context tasks: L42-459 (this decision), L42-456 (the symptom that triggered it)

## Context

The repository holds two independently built and independently deployed applications:

| Unit | Path | Build | Runtime prerequisites |
| --- | --- | --- | --- |
| `web` | `web/` | `next build` (Next.js 16, Turbopack) | needs the API reachable **from the browser** (client components) and **from its own Node process** (server components, SSR) |
| `server` | `server/` | `tsc` | PostgreSQL, schema migrated with `npm run migrate:up`; Elasticsearch only for `/api/search` |

Preview auto-detection can infer a single ordinary app. It cannot infer: two apps, which one is
primary, that the API must be migrated before it starts, or how the two are wired to each other.
The observed consequence (L42-456) was a preview whose homepage rendered
`Could not reach the gallery API (http://p-...-server.preview.localhost:4000/api/categories...)`.

Four properties of the code as it stands today drive the decision:

1. `web/src/lib/config.ts` exposes the API base URL as `NEXT_PUBLIC_API_BASE_URL`, so it is
   **inlined into the client bundle** and must hold a browser-reachable URL. But `/`,
   `/category/[slug]`, `/gif/[slug]` and `/search` all call the API *server-side* as well. In a
   preview, a browser-facing host (`${apps.server.url}`) and a container-facing host
   (`${apps.server.internal}`) are two different names, and only the second resolves from inside
   the `web` container. **One variable cannot satisfy both sides**, and this - not build ordering -
   is what reproduces the L42-456 message on every request (verified end to end, see Verification).
2. `web/src/app/page.tsx` already sets `export const dynamic = 'force-dynamic'` (the L42-456
   frontend fix), and the other three data routes read `searchParams`. `next build`'s route table
   therefore lists `/`, `/category/[slug]`, `/gif/[slug]` and `/search` all as `ƒ` (server-rendered
   on demand) and only `/_not-found` as static: **`next build` no longer touches the API at all**,
   so the preview does not need to order `server`'s start before `web`'s build.
3. `server` reads its whole configuration through `server/src/config/env.ts` with defaults
   (`DATABASE_URL`, `CORS_ORIGIN`, `SITE_URL`, `STORAGE_*`, `ELASTICSEARCH_*`, `GENERATION_*`), and
   starts even when Postgres or Elasticsearch is unreachable - failures surface per route. Its
   `migrate:up` runs through `tsx` and its `build` through `typescript`, both **devDependencies**.
4. Migration `0008_seed_default_categories` seeds categories and `0011_seed_generation_prompts`
   seeds prompts, so a migrated database is not empty. No migration seeds `gifs` rows.

## Decision

Describe the topology explicitly in `.berry/preview.json`, as three units:

1. **`db` service** - `postgres:16-alpine`, port 5432, role `postgres`, database `gif_gallery`,
   password `preview`: a throwaway credential for an isolated container with no production access,
   written literally only because `DATABASE_URL` must match it. Shape matches
   `server/.env.example`'s `DATABASE_URL` (`postgres://user:pass@host:5432/gif_gallery`); `DB_SSL`
   stays at its `false` default.
2. **`server` app** - `dir: server`, `build: npm run build`, `migrate: npm run migrate:up`,
   `start: npm start`, port 3001. Env: `PORT=3001`, `DATABASE_URL` pointed at
   `${services.db.host}`, `CORS_ORIGIN` and `SITE_URL` pointed at `${apps.web.url}`,
   `STORAGE_PROVIDER=local` with `STORAGE_LOCAL_DIR=./storage` and
   `STORAGE_PUBLIC_BASE_URL=${apps.server.url}/storage` (so a locally stored GIF's `url` is
   browser-reachable), background work off (`ELASTICSEARCH_SYNC_ENABLED=false`,
   `GENERATION_SCHEDULER_ENABLED=false`, `GENERATION_RUN_ON_START=false`), and
   `NODE_ENV=development`.

   `NODE_ENV=development` is deliberate and load-bearing, not laziness: npm omits
   `devDependencies` when `NODE_ENV=production`, and this app's `build` (`tsc`) and `migrate`
   (`tsx`) are devDependencies, so a production-flavoured preview can fail to build or migrate at
   all. It also keeps `env.ts`'s production-only assertions out of the way. A preview is not a
   staging replica and must not be read as "the API is production-ready with these settings".
   `NODE_ENV` is intentionally *not* set for `web`, because `next build` manages it.
3. **`web` app (primary)** - `dir: web`, `build: npm run build`,
   `start: npx next start -p 3000 -H 0.0.0.0`, port 3000. Env:
   `NEXT_PUBLIC_API_BASE_URL=${apps.server.url}/api` (browser),
   `API_INTERNAL_BASE_URL=${apps.server.internal}/api` (its own Node process),
   `NEXT_PUBLIC_SITE_URL=${apps.web.url}`.

One supporting code decision follows from it:

**The API base URL becomes two values, not one.** `web/src/lib/config.ts` gains
`resolveApiBaseUrl()`: on the server it prefers `API_INTERNAL_BASE_URL` when set (trailing slashes
stripped), otherwise `API_BASE_URL`; in the browser it always uses `API_BASE_URL`.
`web/src/lib/api.ts` builds every request URL through it, per request. The variable is read lazily
and is **not** `NEXT_PUBLIC_*`, so it stays a server-side runtime lookup and is absent from the
client bundle. Unset - local development, and any deployment where one URL works from both sides -
reproduces today's behaviour exactly.

**Elasticsearch is deliberately not part of the preview**: `ELASTICSEARCH_SYNC_ENABLED=false`, no
third service.

## Options considered

### API URL wiring

| Option | Verdict |
| --- | --- |
| Single `NEXT_PUBLIC_API_BASE_URL=${apps.server.url}/api` | Rejected. This is the L42-456 failure: the browser works, but server rendering inside the container cannot resolve the external preview hostname, so `/`, `/category/*`, `/gif/*` and `/search` fail on **every** request. Reproduced and re-reproduced here. |
| Single `NEXT_PUBLIC_API_BASE_URL=${apps.server.internal}/api` | Rejected. Inverse failure: server rendering works, but the value is inlined into the client bundle, so the search-as-you-type box (`SearchForm`) and `GifCategoryBrowser` break in the browser. |
| Proxy `/api/*` through Next rewrites onto `${apps.server.internal}` | Rejected for now. It works with one URL, but puts the Next server in the request path for every browser API call in production too - a real change to the deployment architecture and its failure modes, for a preview problem. Reconsider if the two origins ever need to look like one (cookies, same-site auth). |
| **Public URL for the browser + internal override for the server (chosen)** | ~10 lines, no production behaviour change when unset, and it is the standard answer for a split preview/deployment. |

### Waiting for the API before `web`'s build

| Option | Verdict |
| --- | --- |
| **No build-time wait (chosen)** | No route prerenders API data any more (`/` is `force-dynamic`, the rest read `searchParams`), so `next build` makes no API calls. A wait would add dead time to every preview build and guard nothing. |
| `web/scripts/wait-for-api.mjs` polling `/api/health` before `next build` | Rejected, and the file (written by an earlier run of this task, before `force-dynamic` landed) was removed. It only mattered while `/` was statically prerendered; keeping it would mean up to 60s of build delay whenever the API is not up first, in exchange for nothing. |
| Declare an ordering/dependency so `server` starts first | Not required for correctness, and not something this repo can guarantee about the harness. The internal URL makes `web` correct whenever the API is up at *request* time. |

**Regression guard:** if any route ever becomes statically prerendered *and* fetches the API at
build time again, either keep it dynamic/ISR-tolerant or reintroduce a bounded, never-failing wait
before `web`'s build - and update this ADR.

### Elasticsearch in the preview

| Option | Verdict |
| --- | --- |
| **No Elasticsearch (chosen)** | `/api/search` is the only consumer (`server/src/routes/search.ts`); every other route is Postgres-backed. `ELASTICSEARCH_SYNC_ENABLED=false` also skips the startup reachability check in `server/src/index.ts`, so the API starts promptly. Keeps the preview to three containers. |
| Add an `elasticsearch:8.19.2` service | Rejected. `server/docker-compose.yml` sizes it at a 512m heap / 1g limit and 30s+ before it is healthy; the index/alias would still need `search:create-index` + `search:reindex` against a database with no `gifs` rows. Cost and flakiness with no reviewable payoff. |
| Make search fall back to Postgres when Elasticsearch is absent | Out of scope here (a backend change to `server/src/search`), and the right long-term answer; filed separately for `backend-engineer`. |

## Consequences

Accepted:

- `/search` and the typeahead suggestions show the API error state in previews (no cluster).
  Reviewers cannot review search behaviour in a preview until a Postgres fallback (or an opt-in
  cluster) exists. Everything else - homepage, categories, gif pages, sitemap/robots - works.
- Category grids render as empty states: migrations seed categories but no `gifs` rows. A preview
  seed is separate, deliberate work.
- Locally stored GIFs (`STORAGE_PROVIDER=local`) live in the container filesystem and vanish with
  the preview.
- `web` now has one more runtime knob (`API_INTERNAL_BASE_URL`). Real deployments that serve the API
  under a single URL leave it unset and behave as before; split deployments should set it.
- `.berry/preview.json` is part of the contract between the two apps: adding an app, a port, a
  migration step or a required env var means updating it in the same change.
- When the API is unreachable, the user-facing error text contains the API URL, which can now be an
  internal hostname. Harmless in a preview (no secret, no production access), but user-facing copy
  should not carry raw URLs; flagged separately.

## Verification

Run in this workspace (Node 22, `npm ci` in both apps):

- `web`: `npx tsc --noEmit` clean; `npm test` **98 tests / 13 files pass**, including
  `src/lib/config.test.ts` covering the three `resolveApiBaseUrl()` cases.
- `web`: `npm run build` succeeds with **no API reachable**; the route table shows `ƒ` for `/`,
  `/category/[slug]`, `/gif/[slug]`, `/search` and `○` only for `/_not-found`, confirming the build
  makes no API calls.
- Bundle check after building with `NEXT_PUBLIC_API_BASE_URL=http://public.preview.test/api` and
  `API_INTERNAL_BASE_URL=http://server-internal.test/api`: the internal host appears in **0** files
  under `.next/static` and **0** non-sourcemap files under `.next/server`; the public host appears
  in the client bundle as expected; `process.env.API_INTERNAL_BASE_URL` survives verbatim in the
  server chunks (runtime lookup, not inlined).
- End-to-end split-URL proof: a stub API on `127.0.0.1:4999` plus `next start` on that same build
  (whose baked public URL `http://public.preview.test/api` is unreachable). With
  `API_INTERNAL_BASE_URL=http://127.0.0.1:4999/api`, `curl /` renders the stub's category
  (`Smoke Reactions`). Without it, `curl /` renders exactly
  `Could not reach the gallery API (http://public.preview.test/api/categories?limit=50&offset=0).
  Is the server running?` - the L42-456 symptom, fixed by the override.
- `server`: `npm run build` clean; `npm test` **222 tests / 35 files pass** (unchanged by this
  work - no server code was touched).
- Every env name in `.berry/preview.json` was checked against `server/src/config/env.ts`
  (`PORT`, `DATABASE_URL`, `CORS_ORIGIN`, `SITE_URL`, `STORAGE_PROVIDER`, `STORAGE_LOCAL_DIR`,
  `STORAGE_PUBLIC_BASE_URL`, `ELASTICSEARCH_SYNC_ENABLED`, `GENERATION_SCHEDULER_ENABLED`,
  `GENERATION_RUN_ON_START`) and the `DATABASE_URL` shape against `server/.env.example`.
- Not verified here: no container runtime is available in this workspace, so the preview was not
  booted end to end. The first preview of this branch is the test - check the homepage listing the
  seeded categories, `/category/<slug>` rendering, and the browser network tab showing typeahead
  calls going to the public `${apps.server.url}` origin.

# Preview environments

This repo has two deployable apps (`server/`, the Express API, and `web/`, the
Next.js frontend) plus a Postgres database. Berry's preview infrastructure
builds/starts each per pull request behind hostnames of the form
`<preview-id>-<app-name>.preview.localhost`.

## `.berry/preview.json`

Before this file existed, Berry had to auto-detect the two-app layout (there
was no repo-level config at all). Auto-detection got the app names, ports and
the `NEXT_PUBLIC_API_BASE_URL` wiring right, but had no explicit way to know
that `web`'s **build** step depends on `server` already being started and
reachable, and no Postgres service or migration step was declared for
`server` at all.

`.berry/preview.json` now declares that explicitly:

- `server` (dir `server/`): `npm run build` → `npm run migrate:up` → `npm
  start`, port `3001` (matches `server/.env.example`'s `PORT=3001`),
  `DATABASE_URL` pointed at the declared `db` service, `CORS_ORIGIN`/`SITE_URL`
  set to the `web` app's public URL.
- `web` (dir `web/`, primary): `npm run build` → `npx next start -p 3000`,
  port `3000`, `NEXT_PUBLIC_API_BASE_URL` set to `${apps.server.url}/api` and
  `NEXT_PUBLIC_SITE_URL` to `${apps.web.url}`.
- `db`: `postgres:16-alpine`, credentials matched to `server`'s `DATABASE_URL`.

Because `web`'s env references `${apps.server.url}`, Berry resolves that
dependency before building `web` — i.e. `server` (and the `db` service it
needs) must be built, migrated and started first. That ordering is the fix;
see "Root cause" below for why it matters specifically for this repo.

## Root cause of L42-456 ("Could not reach the gallery API" at build time)

`web/src/app/page.tsx` (the homepage) fetches `/api/categories` from an
`async` Server Component with `fetch(..., { next: { revalidate: 60 } })`. It
has no dynamic segment, so Next.js statically generates it *during `next
build`* (confirmed locally: `next build` output lists `/` as `○ (Static)`).

That means the homepage's data fetch to the `server` app runs **at build
time**, not just at request time. Reproduced locally:

- `next build` with the API completely unreachable **succeeds** (exit 0) —
  `web/src/lib/api.ts#apiFetch` catches the network failure and throws an
  `ApiError`, which `page.tsx` catches and renders as an `ErrorState` instead
  of re-throwing. The build does not crash.
- But the *static HTML Next.js just generated* for `/` has that exact message
  baked into it: `.next/server/app/index.html` contained `Could not reach the
  gallery API (http://127.0.0.1:59999/api/categories?limit=50&offset=0). Is
  the server running?` — this is what a preview visitor then sees on the
  homepage, verbatim, until the next ISR revalidation (up to 60s later, and
  only once a request actually triggers one).
- Timed the compiled `server` app's cold start (`node dist/index.js`) against
  an unreachable DB/Elasticsearch: it does not accept connections for
  roughly 2-3 seconds after the process starts (module load + the startup DB
  check it performs before calling `app.listen`), confirmed via repeated
  `curl` against `/api/health` immediately after launch vs. a few seconds
  later.

So this is root cause **(a) build/deploy ordering**, not (b) DNS/hostname
resolution (a plain unreachable IP reproduces the identical message, no
`*.preview.localhost` involved), not (c) the backend crashing (it starts and
serves `/api/health` fine once given a couple of seconds and reachable
Postgres), and not primarily (d) — there's no retry at all today, but a
retry is a defensive improvement, not the reason this fails 100% of the time:
with no `.berry/preview.json`, nothing ordered `server`'s start before
`web`'s build, so the race was effectively guaranteed, not transient.

## Fix

Add `.berry/preview.json` (this change) so Berry builds/migrates/starts
`server` (and its `db` service) first, then resolves `${apps.server.url}`
into `web`'s build-time env before running `web`'s build. This removes the
ordering race at the infra level, with no application code changes.

## Verification performed

- `cd server && npm ci && npm run build` — compiles cleanly.
- `cd web && npm ci && NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:<unreachable-port>/api npm run build` —
  succeeds, but bakes the "Could not reach the gallery API" message into
  `/`'s static HTML, reproducing L42-456 exactly.
- Started the compiled `server` app first (`node dist/index.js`, port
  reachable within ~3s), then ran `web`'s build pointed at that live server:
  the "Could not reach the gallery API" message no longer appears anywhere in
  the generated HTML. The only remaining error in that specific local test
  was an unrelated `ECONNREFUSED` from Postgres — expected, since the local
  repro used a fake, unreachable `DATABASE_URL` rather than a real seeded
  database. In the actual preview, `.berry/preview.json`'s `db` service and
  `server`'s `migrate` step (`npm run migrate:up`, which includes
  `0008_seed_default_categories`) provide that real data, so `/api/categories`
  succeeds once `server` is up.

## Rollback

Revert/delete `.berry/preview.json`. Preview builds fall back to Berry's
auto-detected layout (the state before this change) — no other repo files are
touched, so this is a single-file revert with no data or infra migration
involved.

## Follow-ups flagged to other roles (not fixed here — out of devops scope)

Filed as `propose_work` against `backend-engineer` (and `security-engineer`
as reviewer):

1. `server`'s startup (`src/index.ts`) awaits an Elasticsearch reachability
   check (`ELASTICSEARCH_SYNC_ENABLED` defaults `true`, with a 10s request
   timeout) *before* calling `app.listen()`. If Elasticsearch isn't up yet in
   a given preview, `server` takes measurably longer to start accepting
   connections at all. The ordering fix here (waiting for `server` to be
   listening) tolerates that, but a few extra seconds of build-blocking delay
   per preview is worth trimming — e.g. don't block `app.listen()` on that
   check.
2. The API's generic error handler currently returns raw internal error text
   (e.g. `connect ECONNREFUSED 127.0.0.1:1`) in the JSON `error` field for at
   least DB-connectivity failures, and the frontend (`web/src/lib/api.ts`)
   surfaces that string verbatim to users on `ErrorState`. Minor
   information-leak/UX issue, unrelated to this ticket's root cause.
3. Optional frontend hardening (not required — this ticket's root cause is
   fully addressed by the ordering fix, and the homepage already degrades
   gracefully instead of crashing the build): the homepage's build-time fetch
   could add a couple of retries with backoff before giving up, so a preview
   still renders real data if there's any residual startup jitter beyond what
   the health/ordering gate covers. Left to `frontend-engineer` to decide if
   it's worth the complexity given the ordering fix already removes the
   guaranteed race.

---

## Update (L42-459, ADR 0001): two API URLs, and no build-time wait

Architecture review of the config above, against the repo as it stands now, changed two things.
The full reasoning, options and consequences are in
[`docs/adr/0001-preview-environment-topology.md`](adr/0001-preview-environment-topology.md);
this is the short version.

**1. `${apps.server.url}` alone is not enough — the server side needs the internal URL.**
`NEXT_PUBLIC_API_BASE_URL` is inlined into the client bundle, so it has to be the *browser-facing*
preview hostname. But `/`, `/category/[slug]`, `/gif/[slug]` and `/search` also call the API from
inside the `web` container, and that hostname does not resolve there — which is the
`Could not reach the gallery API (http://p-...-server.preview.localhost:4000/api/...)` message from
L42-456, on every request rather than only at build time. `web` therefore now gets **both**:

- `NEXT_PUBLIC_API_BASE_URL=${apps.server.url}/api` — the browser,
- `API_INTERNAL_BASE_URL=${apps.server.internal}/api` — its own Node process.

`web/src/lib/config.ts#resolveApiBaseUrl()` picks between them (browser: always the public one;
server: the internal one when set), and `web/src/lib/api.ts` resolves it per request.
`API_INTERNAL_BASE_URL` is intentionally not a `NEXT_PUBLIC_*` var and stays out of the client
bundle (verified: 0 occurrences under `.next/static`). Unset, behaviour is exactly as before.

**2. The ordering race described above no longer exists, so nothing waits for the API.**
`web/src/app/page.tsx` now sets `export const dynamic = 'force-dynamic'` (the frontend half of the
L42-456 fix), and the other data routes read `searchParams`, so `next build`'s route table marks
every data route `ƒ` (server-rendered on demand) and `next build` makes no API calls at all. The
"`server` must be built, migrated and started before `web` builds" requirement in the section above
is therefore no longer load-bearing — the preview only needs the API to be up when a *request*
arrives. A `web/scripts/wait-for-api.mjs` build-time gate was written for this task and then
removed for the same reason; if a route ever becomes statically prerendered with API data again,
reintroduce a bounded, never-failing wait (or keep the route dynamic) and update the ADR.

**Also changed in `.berry/preview.json`:** `NODE_ENV=development` for `server` (npm omits
`devDependencies` when `NODE_ENV=production`, and `build`/`migrate:up` need `typescript`/`tsx`),
`STORAGE_LOCAL_DIR`/`STORAGE_PUBLIC_BASE_URL` so locally stored GIF URLs are browser-reachable,
`GENERATION_RUN_ON_START=false`, and `-H 0.0.0.0` on `next start`. Elasticsearch stays out of the
preview (`ELASTICSEARCH_SYNC_ENABLED=false`), which also skips the startup reachability check in
`server/src/index.ts`; the cost is that `/api/search` and the typeahead show their error state in
previews until search can fall back to Postgres.

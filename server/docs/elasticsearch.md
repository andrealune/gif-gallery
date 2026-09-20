# Elasticsearch (GIF search)

Search-oriented index of the GIF catalog (title, description, tags,
category), separate from Postgres' own full-text column
(`gifs.search_vector`, see [`docs/database-schema.md`](./database-schema.md)).
Elasticsearch is the preferred backend for the public search API
(`GET /api/search`, `src/routes/search.ts`), ranked and filtered by
`src/search/searchQuery.ts`.

**Postgres fallback (L42-461).** Elasticsearch is deliberately absent from
preview environments (extra container, 512m heap, 30s+ readiness, index
creation/reindex against a database with no gif rows - see
`.berry/preview.json`, which sets `ELASTICSEARCH_ENABLED=false`), and a
production cluster can legitimately be unreachable too. `GifSearchQueryService`
(`src/search/searchService.ts`) uses `src/search/postgresFallback.ts`'s
`PostgresGifSearchFallback` - full-text search over `gifs.search_vector` plus
tags, same `{ items, total, limit, offset }` shape - whenever
`ELASTICSEARCH_ENABLED=false`, or automatically per request when a query
against the cluster throws. Either way the result is tagged `degraded: true`,
which `routes/search.ts` turns into a `degraded: true` response field and an
`X-Search-Degraded: true` header, so the client can show a "basic search"
notice instead of silently returning lower-relevance results as if nothing
changed. This fallback intentionally has no fuzzy/typo tolerance and no
cross-field relevance scoring - it is "basic search", not full parity with
Elasticsearch.

Code lives in `src/search/`:

| File                    | Responsibility                                                             |
| ----------------------- | --------------------------------------------------------------------------- |
| `client.ts`             | Elasticsearch client factory + shared instance, connection health check    |
| `gifsIndex.ts`          | Index mapping (schema) + settings + versioned index/alias naming          |
| `documentMapper.ts`     | Maps a Postgres row to the document shape stored in the index             |
| `repository.ts`         | Reads active gifs (+ category, + tags) from Postgres, keyset-paginated    |
| `pipeline.ts`           | Index lifecycle: create index, bulk load, alias swap, prune old versions  |
| `createIndex.ts`        | CLI: bootstrap an empty index + alias (`npm run search:create-index`)     |
| `reindex.ts`            | CLI: full (re)build from Postgres (`npm run search:reindex`)              |
| `syncJob.ts`            | Incremental sync job: keeps the index in step with individual gif writes (L42-419) |
| `sync.ts`               | CLI: runs the sync job standalone (`npm run search:sync`)                 |
| `searchQuery.ts`        | Builds the ranked/filtered Elasticsearch request for `GET /api/search`    |
| `searchService.ts`      | Query service: runs the ES (or Postgres fallback) query, hydrates from Postgres |
| `postgresFallback.ts`   | Postgres full-text fallback used when Elasticsearch is disabled/unreachable (L42-461) |

## Running a cluster

**Local development** - a single-node cluster with security disabled, via
the `docker-compose.yml` in `server/`:

```bash
cd server
docker compose up -d
docker compose logs -f          # wait for "started"
curl http://localhost:9200      # sanity check
```

This is a dev-only configuration (no auth, no TLS) - never point
`ELASTICSEARCH_NODE` at this outside a developer machine or CI runner.

**Production / staging** - use a managed cluster (e.g. Elastic Cloud, or a
self-hosted cluster behind TLS with security enabled) and set:

```
ELASTICSEARCH_NODE=https://your-cluster.es.region.cloud.es.io:443
ELASTICSEARCH_API_KEY=...            # preferred, or:
ELASTICSEARCH_USERNAME=...
ELASTICSEARCH_PASSWORD=...
ELASTICSEARCH_INDEX_REPLICAS=1       # or more, for availability/read throughput
```

`src/search/client.ts` warns at startup (does not fail the boot) if
`ELASTICSEARCH_NODE` looks like a remote host with no credentials
configured - that combination is almost always a misconfiguration.

All `ELASTICSEARCH_*` variables are documented in `.env.example`.

## Index schema

One document per *active* gif (archived/flagged/soft-deleted gifs are
excluded, matching the public listing convention used by
`services/categories`). Mapping is defined in `src/search/gifsIndex.ts`:

| Field                | Type                          | Notes                                                              |
| --------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `id`                  | `keyword`                     | Postgres `gifs.id` (UUID), also the document `_id`                 |
| `title`               | `text` (`english` analyzer) + `title.keyword` | Primary relevance field                             |
| `description`         | `text` (`english` analyzer)   |                                                                     |
| `tags`                | `keyword` + `tags.text`       | Exact match/faceting (`keyword`) and free-text (`.text`)           |
| `category.id`         | `keyword`                     |                                                                     |
| `category.name`       | `text` (`english`) + `.keyword` |                                                                   |
| `category.slug`       | `keyword`                     |                                                                     |
| `status`              | `keyword`                     | Always `active` today; kept for future filtering                   |
| `source`              | `keyword`                     | `giphy` / `tenor` / `upload` / `ai_generated` / `other`             |
| `url` / `thumbnailUrl`| `keyword`, `index: false`     | Stored for rendering results, never searched on                    |
| `createdAt` / `updatedAt` | `date`                    |                                                                     |

`title`/`description`/`category.name` use the `english` analyzer -
deliberately the same choice already made for Postgres'
`gifs.search_vector` (migration `0005_create_gifs_table`), so stemming and
stopword behaviour is consistent between the two search paths.

## Scale: settings for 10k-100k documents

At this scale (a GIF catalog metadata document is well under 1KB; 100k
documents is on the order of tens of MB) a single primary shard is both
sufficient and faster to query than splitting further - more shards only
adds cross-shard coordination overhead for an index this small.
`ELASTICSEARCH_INDEX_SHARDS` defaults to `1`. Replicas default to `0` (no
second node to hold them in the local single-node cluster) and should be
raised to `1` or more in production for availability and extra read
throughput; this does not require a reindex, just:

```
PUT gifs_v1/_settings
{ "index": { "number_of_replicas": 1 } }
```

## Indexing pipeline

### Initial load / full rebuild

```bash
cd server
npm run search:reindex
```

This streams every active gif out of Postgres (keyset-paginated by `id`, so
memory use stays flat regardless of catalog size) joined with its category
and tag names, and bulk-indexes it into a **new** versioned index
(`gifs_v1`, `gifs_v2`, ...) via the Elasticsearch client's `helpers.bulk`
(batches requests, retries transient failures with backoff). Once every
document is indexed, the `gifs` alias is atomically repointed at the new
index - the application (and any concurrent search request) only ever reads
the alias, so a rebuild causes no downtime and no visible inconsistency
(readers see either the fully-old or the fully-new index, never a partial
one).

By default the *previous* version is kept (not deleted) so a bad rebuild can
be rolled back; anything older than that is pruned automatically. Flags:

```bash
npm run search:reindex -- --no-prune   # keep every old version
npm run search:reindex -- --keep 3     # keep 3 previous versions instead of 1
```

### Bootstrapping an empty index

```bash
npm run search:create-index
```

Creates the next versioned index and points the alias at it if the alias
does not exist yet, without indexing anything. Mostly useful for verifying
connectivity/mapping in isolation, or as an idempotent bootstrap step in a
deploy script; `search:reindex` also creates the index itself when needed,
so this is optional in normal operation.

### Rollback

Because the alias always points at exactly one versioned index, rolling
back a bad reindex is a single atomic alias swap - no data loss, no
downtime:

```bash
curl -X POST "$ELASTICSEARCH_NODE/_aliases" -H 'content-type: application/json' -d '{
  "actions": [
    { "remove": { "index": "gifs_v2", "alias": "gifs" } },
    { "add":    { "index": "gifs_v1", "alias": "gifs" } }
  ]
}'
```

(Substitute the actual current/previous index names - `GET _alias/gifs`
shows the current target; `GET _aliases` or `GET gifs_v*` lists every
version still on disk.)

### Keeping the index in sync going forward (L42-419)

`reindex.ts` rebuilds the whole index from scratch; it is not run on every
write. Staying in sync with individual gif create/update/(soft-)delete
calls as they happen is `syncJob.ts`'s job:

- It polls `GifSearchSourceRepository#fetchChanges` (keyset-paginated on
  `(updated_at, id)`, so a full sweep of the change history is O(1) per page
  like the reindex path) for every gif whose `updated_at` moved past an
  in-memory cursor.
- A gif with `status = 'active'` is upserted (`toGifDocument` -> index by
  `id`, so re-processing the same row is a no-op-safe overwrite).
- A gif in any other status (archived/flagged/soft-deleted) is deleted from
  the index by `id` (a 404 - already absent - is treated as success, not a
  failure).
- Because it drives off `updated_at` rather than being called from each
  write site, it automatically covers every current and future way a gif
  row changes (today: the Tenor importer's insert/update; later: an admin
  API, AI-generated uploads, ...) without that code needing to remember to
  notify a search index.

This was built as a small **custom job scheduler** (a polling loop, in
`createGifSearchSyncJob`) rather than wiring up Logstash's JDBC input
plugin: the app already owns a typed Elasticsearch client and document
mapper in `src/search/`, and at the 10k-100k document scale this catalog
targets, a plain polling loop with no extra service to deploy/operate is
simpler and keeps the document shape defined in one place
(`documentMapper.ts`) instead of duplicated into a separate Logstash
pipeline config.

**Running it.** By default it runs inline inside the API process
(`src/index.ts`, started right after the initial DB connectivity check,
stopped on graceful shutdown). To run it as its own process/worker instead,
set `ELASTICSEARCH_SYNC_ENABLED=false` on the API process and run:

```bash
cd server
npm run search:sync
```

Running it in both places at once is harmless (each keeps its own
in-memory cursor and every operation is idempotent) but redundant.

**Tuning** (see `.env.example`): `ELASTICSEARCH_SYNC_INTERVAL_MS` (poll
interval once a poll finds nothing new, default 5s), `ELASTICSEARCH_SYNC_BATCH_SIZE`
(rows per page, default 200), `ELASTICSEARCH_SYNC_STARTUP_OVERLAP_MS`
(how far back the cursor starts on boot, default 60s, so a restart
re-covers a window of recent changes rather than only changes from the
moment it comes back up).

**Limits / when to still run `search:reindex`.** The cursor lives in
memory only - a page crossing a restart is harmless (upserts/deletes are
idempotent, so the `startupOverlapMs` window is simply re-applied), but a
gap *larger* than that window (extended downtime, a direct SQL write, a
migration backfill) is not automatically caught up. Run
`npm run search:reindex` periodically (e.g. a nightly cron) as the
reconciliation safety net, the same way it already is for the initial load.

## Testing

`test/search/` covers the pure logic that does not require a live cluster:
document mapping (Postgres row -> ES document), the alias/version naming
math used by the pipeline, and the sync job's batching/cursor/upsert-vs-
delete logic (all via a fake client, same pattern as
`test/tenor/client.test.ts`'s fake `fetch`). There is no integration test
against a real Elasticsearch cluster in CI yet.

## Postgres fallback (`SEARCH_BACKEND`, L42-463)

`GET /api/search` no longer hard-depends on Elasticsearch. `src/search/backend.ts#createGifSearchQueryService`
picks the implementation `routes/search.ts` uses, controlled by `SEARCH_BACKEND` (`.env.example`):

- `elasticsearch`: always the `GifSearchQueryService` documented above. Fails at query time if the
  cluster is unreachable/misconfigured - unchanged from before this switch existed.
- `postgres`: always `PostgresGifSearchQueryService` (`src/search/postgresSearchService.ts`) - ranks and
  hydrates in a single Postgres query, no Elasticsearch dependency at all.
- `auto` (default): infers from `ELASTICSEARCH_SYNC_ENABLED` above - Elasticsearch when it's `true`,
  Postgres when it's `false`. Every preview environment sets `ELASTICSEARCH_SYNC_ENABLED=false` (ADR
  0001 - previews have no Elasticsearch service/cluster) and now also sets `SEARCH_BACKEND=postgres`
  explicitly in `.berry/preview.json`, so `/search` and the header typeahead work (with the ranking
  caveats below) in every preview instead of showing the API error state.

Both backends implement the same `GifSearchQueryServiceLike` interface and return the exact same
`{ items, total, limit, offset }` shape (`routes/search.ts` wraps it into the same `{ data, pagination }`
envelope either way), so `web/src/lib/api.ts#searchGifs` needed no change.

**Ranking quality is lower on the Postgres backend.** It uses only core Postgres full-text search - the
`gifs.search_vector` generated `tsvector` column already created by `migrations/0005` (title weighted
`A`, description weighted `B`), combined on the fly with the gif's category name and tag names (not
part of `search_vector`, joined and `to_tsvector`'d per query instead):

- Per-word **prefix** matching (`token:*`) instead of Elasticsearch's `fuzziness: 'AUTO'` - a typo is
  not tolerated, only a partial trailing word (the header typeahead's common case, e.g. "danc" still
  matches "dancing").
- No cross-field boosting beyond `search_vector`'s fixed weights - category/tag matches rank at the
  same (lowest, implicit) weight rather than Elasticsearch's tuned `title^3`/`tags.text`/`category.name`
  fields (`searchQuery.ts#SEARCH_FIELDS`).
- Tag/category matching is a correlated subquery per row, not GIN-indexed like `search_vector` itself -
  fine at this project's target catalog size (`gifsIndex.ts`: 10k-100k documents) but not as fast as
  Elasticsearch at any scale.
- Deliberately **no `pg_trgm`**/other contrib extension: `test/migrations.test.ts` runs the whole schema
  against the embedded PGlite engine, which has no contrib extensions available at all (see
  `migrations/0001_enable_extensions.up.sql`'s note) - the Postgres fallback only relies on core
  `tsvector`/`tsquery`, so it works in that same environment.

**Testing.** `test/search/postgresSearchService.test.ts` and
`test/search/routes.postgresBackend.test.ts` cover the Postgres backend against a real (embedded)
Postgres, the same PGlite technique `test/migrations.test.ts` uses - ranking order, category filtering
(by id and by slug), tag matching, pagination/total, and the empty-query/no-match edge cases.
`test/search/backend.test.ts` covers `SEARCH_BACKEND`'s `elasticsearch`/`postgres`/`auto` resolution.

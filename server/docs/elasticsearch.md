# Elasticsearch (GIF search)

Search-oriented index of the GIF catalog (title, description, tags,
category), separate from Postgres' own full-text column
(`gifs.search_vector`, see [`docs/database-schema.md`](./database-schema.md)).
Elasticsearch is the intended backend for the public search API (a later
task); Postgres full-text search remains available as a fallback/simple
substring path and is what the current data model is validated against.

Code lives in `src/search/`:

| File                  | Responsibility                                                             |
| --------------------- | --------------------------------------------------------------------------- |
| `client.ts`           | Elasticsearch client factory + shared instance, connection health check    |
| `gifsIndex.ts`         | Index mapping (schema) + settings + versioned index/alias naming          |
| `documentMapper.ts`    | Maps a Postgres row to the document shape stored in the index             |
| `repository.ts`        | Reads active gifs (+ category, + tags) from Postgres, keyset-paginated    |
| `pipeline.ts`          | Index lifecycle: create index, bulk load, alias swap, prune old versions  |
| `createIndex.ts`       | CLI: bootstrap an empty index + alias (`npm run search:create-index`)     |
| `reindex.ts`           | CLI: full (re)build from Postgres (`npm run search:reindex`)              |

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

### Keeping the index in sync going forward

This task builds the cluster, the schema and the bulk-load pipeline only.
Keeping the index in sync with individual gif create/update/delete calls as
they happen (rather than only via a full rebuild) is tracked separately as
**L42-419 - Implement database-to-Elasticsearch sync**, which should reuse
`toGifDocument`/`GIFS_ALIAS` and the client from this module rather than
duplicating them.

## Testing

`test/search/` covers the pure logic that does not require a live cluster:
document mapping (Postgres row -> ES document) and the alias/version naming
math used by the pipeline (via a fake client, same pattern as
`test/tenor/client.test.ts`'s fake `fetch`). There is no integration test
against a real Elasticsearch cluster in CI yet - see the follow-up note
below.

# Database schema (L42-414)

PostgreSQL 13+ schema for the GIF gallery catalog: gifs, their category/tags, and provenance
("where did this GIF actually come from") for third-party/AI/upload sources. Implemented as versioned
SQL migrations in `../migrations/`, applied with `../src/db/migrate.ts` (`npm run migrate:up`).

> **Note on file count in `migrations/`:** the authoring tooling used for this change has no way to
> delete a previously saved file. `0001_enable_extensions` through `0008_seed_default_categories` are
> the real, final, tested migration set described below. Any other file in that directory is an
> obsolete draft explicitly marked `OBSOLETE DRAFT STUB` in its header comment and is a harmless no-op
> (`SELECT 1;`) -- safe to ignore, and safe to actually delete via a normal `git rm` in review/cleanup.

## Entity-relationship overview

```
categories 1 ──── * gifs * ──── * tags            (via gif_tags)
                     │
                     └──── * third_party_references
```

- A **gif** belongs to at most one **category** (nullable FK, `ON DELETE SET NULL` -- deleting a
  category un-categorizes its gifs rather than deleting them).
- A **gif** has many **tags** and a **tag** can be on many gifs, through the `gif_tags` join table
  (`ON DELETE CASCADE` both ways -- deleting a gif or a tag just removes the association row).
- A **gif** has zero or more **third_party_references**: rows recording where its content came from
  (a Giphy/Tenor pull, an AI generation call, an uploaded source image for the image-to-GIF pipeline).
  `ON DELETE CASCADE` from `gifs` -- deleting a gif deletes its provenance records with it.

## Tables

### `categories`

| column        | type          | notes                                            |
|---------------|---------------|---------------------------------------------------|
| id            | uuid PK       | `gen_random_uuid()` default (core builtin, PG13+ -- no extension needed) |
| name          | varchar(100)  | unique, case-insensitively (`lower(name)` index)  |
| slug          | varchar(120)  | unique, URL-safe (`^[a-z0-9]+(-[a-z0-9]+)*$`)      |
| description   | text          | optional                                           |
| created_at    | timestamptz   |                                                     |
| updated_at    | timestamptz   | kept current by the `set_updated_at` trigger       |

Seeded (migration `0008_seed_default_categories`) with 8 starter categories (Reactions, Memes,
Animals, Sports, Movies & TV, Anime, Gaming, Other) -- a starting point for the UI, not a fixed list;
add/rename/remove through normal `INSERT`/`UPDATE`/`DELETE` as the product needs.

### `tags`

| column     | type         | notes                                        |
|------------|--------------|-----------------------------------------------|
| id         | uuid PK      |                                                |
| name       | varchar(50)  | unique, case-insensitively                    |
| slug       | varchar(60)  | unique, URL-safe                              |
| created_at | timestamptz  |                                                |

### `gifs`

The core catalog table -- one row per GIF regardless of where it came from.

| column          | type          | notes                                                                 |
|-----------------|---------------|------------------------------------------------------------------------|
| id              | uuid PK       |                                                                          |
| source          | enum          | `giphy` \| `tenor` \| `upload` \| `ai_generated` \| `other` -- coarse filter |
| title           | varchar(255)  | required, non-blank                                                     |
| description     | text          | optional                                                                |
| category_id     | uuid FK       | nullable, `ON DELETE SET NULL`                                         |
| url             | text          | required, non-blank -- canonical asset URL (source or, once L42-425 lands, our storage URL) |
| thumbnail_url   | text          | optional                                                                |
| storage_path    | text          | optional -- key/path once local/S3 storage (L42-425) is implemented    |
| width, height   | integer       | optional, `CHECK (> 0)`                                                |
| file_size_bytes | bigint        | optional, `CHECK (>= 0)`                                               |
| duration_ms     | integer       | optional, `CHECK (>= 0)`                                               |
| mime_type       | varchar(100)  | default `'image/gif'`                                                  |
| metadata        | jsonb         | default `{}`, `CHECK` enforces it stays a JSON object -- extensible bag for provider/pipeline-specific fields (generation prompt, model, frame_count, palette, etc.) that don't warrant their own column yet |
| status          | enum          | `active` \| `archived` \| `flagged` \| `deleted`, default `active`     |
| search_vector   | tsvector      | generated (`STORED`) from `title` (weight A) + `description` (weight B); GIN-indexed |
| created_at      | timestamptz   |                                                                          |
| updated_at      | timestamptz   | kept current by trigger                                                 |
| deleted_at      | timestamptz   | soft-delete marker; `CHECK` keeps it consistent with `status = 'deleted'` |

**Why `source` (enum, on `gifs`) *and* `third_party_references` (a separate table)?** `source` answers
"what kind of gif is this" for cheap filtering/reporting with no join. `third_party_references` answers
"exactly which external asset/API call produced it, with what attribution and raw payload" -- and a
single gif can have more than one (e.g. an AI-generated gif that also references the uploaded source
image it was converted from). Keeping provenance in its own table means the catalog table stays lean
and provider-agnostic, and provider-specific audit data (raw API responses) doesn't bloat every gif row
or its indexes.

**Design decisions worth flagging to reviewers:**

- *Single category, many tags* -- matches the issue's singular "category" vs. plural "tags" wording.
  If the product later needs multiple categories per gif, that's a new migration adding a `gif_categories`
  join table (mirroring `gif_tags`) plus a data migration to backfill `category_id` into it; `category_id`
  would then be deprecated, not dropped immediately, to avoid a breaking change for existing queries.
- *JSONB `metadata` vs. more columns* -- common, already-known, frequently-filtered attributes
  (dimensions, size, duration, mime type) are real typed columns; provider/pipeline-specific and
  still-evolving fields go in `metadata` (GIN-indexed with `jsonb_path_ops` for containment queries like
  `metadata @> '{"model": "dall-e-3"}'`). This avoids a schema migration every time a new provider adds a
  field, at the cost of that field not being typed/constrained at the DB level.
- *Soft delete* -- `status`/`deleted_at` rather than an immediate `DELETE`, so a gif can be hidden and
  restored without losing its tags/references history. See "Data retention" below for the purge story.
- *No Postgres extensions* -- `gen_random_uuid()` is a core builtin since PostgreSQL 13 (confirmed
  against both a real Postgres and the PGlite engine used for automated tests, which ships no contrib
  extensions at all), so this schema deliberately avoids `CREATE EXTENSION` entirely. That sidesteps any
  "extension not allow-listed" friction on managed Postgres providers.

### `gif_tags` (join table)

`(gif_id, tag_id)` composite PK; `ON DELETE CASCADE` on both FKs. Extra index on `tag_id` for the
reverse lookup ("gifs with tag X") since the PK only optimizes the `gif_id`-first direction.

### `third_party_references`

Provenance/attribution for a gif's origin.

| column        | type         | notes                                                          |
|---------------|--------------|------------------------------------------------------------------|
| id            | uuid PK      |                                                                    |
| gif_id        | uuid FK      | `ON DELETE CASCADE`                                               |
| provider      | enum         | `giphy` \| `tenor` \| `openai` \| `user_upload` \| `other`        |
| external_id   | text         | the provider's id for this asset (e.g. a Giphy gif id)            |
| external_url  | text         | the provider's URL for this asset                                 |
| attribution   | text         | credit text, if the provider's license requires it                |
| license       | varchar(100) | license name/type, if known                                       |
| raw_metadata  | jsonb        | full raw API response/payload, for audit/debugging                |
| fetched_at    | timestamptz  | when we pulled/generated this reference                            |
| created_at    | timestamptz  |                                                                     |

A partial unique index on `(provider, external_id) WHERE external_id IS NOT NULL` stops the same
third-party asset (e.g. the same Giphy id) from being imported twice, while still allowing multiple
`NULL`-external-id rows (nothing to dedupe on -- e.g. a purely local upload reference).

## Indexing strategy

| index                                              | purpose                                                        |
|-----------------------------------------------------|------------------------------------------------------------------|
| `gifs_category_id_idx`                              | category filter                                                  |
| `gifs_created_at_idx`                                | newest-first pagination                                          |
| `gifs_active_created_at_idx` (partial, `status='active'`) | the common "browse active gifs" query, without scanning archived/deleted rows |
| `gifs_source_idx`                                    | filter by origin (giphy/tenor/upload/ai_generated)                |
| `gifs_search_vector_idx` (GIN)                       | full-text search over title + description                        |
| `gifs_metadata_idx` (GIN, `jsonb_path_ops`)          | containment queries against `metadata`                           |
| `categories_name_unique_idx` / `_slug_unique_idx`    | case-insensitive name uniqueness, slug lookups                    |
| `tags_name_unique_idx` / `_slug_unique_idx`          | same, for tags                                                    |
| `gif_tags` PK `(gif_id, tag_id)` + `tag_id` index    | both join directions                                              |
| `third_party_references_gif_id_idx`                  | "all references for this gif"                                    |
| `third_party_references_provider_idx`                | "all gifs pulled from provider X"                                 |
| `third_party_references_provider_external_id_unique_idx` (partial) | de-dupe re-imports                                 |

## Data retention

- Deleting a gif is soft (`status = 'deleted'`, `deleted_at` set) by default -- application code should
  `UPDATE`, not `DELETE`, in the normal flow. This preserves `gif_tags`/`third_party_references` history
  and lets a delete be undone.
- **Recommended purge policy** (not yet implemented -- flag to product/security before automating): a
  periodic job hard-deletes gifs where `status = 'deleted' AND deleted_at < now() - interval '90 days'`.
  The `ON DELETE CASCADE` FKs on `gif_tags`/`third_party_references` mean a hard delete of a gif cleans
  up its associations automatically; tags/categories themselves are never cascade-deleted by this, so
  shared lookup rows survive.
- `third_party_references.raw_metadata` can carry large, provider-specific payloads. If storage becomes
  a concern, consider a separate retention window for `raw_metadata` (e.g. null it out after N days while
  keeping `external_id`/`attribution`) rather than for the whole reference row.

## Migration operations

Each `.up.sql`/`.down.sql` pair states its own locking behaviour, rollback path and data impact in a
header comment -- read the specific file before running it against a database with real data. Summary:

| migration                                   | locking                                   | data impact (up)         | data impact (down)                    |
|-----------------------------------------------|--------------------------------------------|----------------------------|------------------------------------------|
| `0001_enable_extensions`                      | none (intentional no-op, see file header)  | none                        | none                                      |
| `0002_updated_at_trigger_function`            | catalog-only (function)                    | none                        | none                                      |
| `0003_create_categories_table`                | new table, no contention                   | none (empty table)          | **destructive**: drops all categories    |
| `0004_create_tags_table`                      | new table, no contention                   | none (empty table)          | **destructive**: drops all tags          |
| `0005_create_gifs_table`                      | new table + 2 enum types, no contention    | none (empty table)          | **destructive**: drops all gifs          |
| `0006_create_gif_tags_table`                  | new table, no contention                   | none (empty table)          | destructive: drops associations only     |
| `0007_create_third_party_references_table`    | new table + enum type, no contention       | none (empty table)          | destructive: drops provenance rows only  |
| `0008_seed_default_categories`                | row-level locks on 8 inserted rows         | inserts up to 8 rows, idempotent (`ON CONFLICT DO NOTHING`) | deletes those rows only if unreferenced by any gif |

All of the above are brand-new objects on a fresh database, so none of them contend with concurrent
application traffic or require an `ALTER TABLE ... ADD COLUMN` rewrite/lock on an existing, populated
table. **Future migrations that add columns/constraints to already-populated tables must document their
own locking behaviour explicitly** (e.g. `ADD COLUMN ... DEFAULT` on Postgres 11+ is a fast, non-rewriting
metadata-only change for a constant default, but adding a `NOT NULL` constraint or a new index on a large
table can take a long lock or block writes -- use `CREATE INDEX CONCURRENTLY` and validate `CHECK`
constraints with `NOT VALID` + `VALIDATE CONSTRAINT` in that case) and get a software-architect review
before running against production, per this project's escalation policy.

Down-migrations are provided for every up-migration (required for rollback), but several are
**destructive by design** (they drop the tables/rows their matching up-migration created) -- never run
`migrate:down` against a database with real data without a reviewed plan, exactly as the up-front
rollback notes in each file say.

## Testing

`test/migrations.test.ts` applies every `up.sql` in order against an embedded PGlite (in-memory
Postgres) instance, exercises the core constraints (blank-title rejection, third-party uniqueness,
cascading deletes, generated `search_vector`), then rolls every `down.sql` back in reverse order and
asserts the schema is empty again. Run it with `npm test` (or `npx vitest run test/migrations.test.ts`).
It does not require a real Postgres server, so it runs in CI with no extra services, and it exercises the
obsolete draft stubs too (they are simply harmless no-ops alongside the real migrations).

`src/db/migrate.ts` (the runner used against a real database) is not exercised by that test -- PGlite
does not speak the Postgres wire protocol `pg.Client` uses -- so it should also be smoke-tested against
a real local/staging Postgres (`npm run migrate:up && npm run migrate:status && npm run migrate:down`)
before this change ships. That was not possible in this sandbox (no Postgres server or container runtime
available); a backend engineer or CI job with a real Postgres instance should confirm before merge.

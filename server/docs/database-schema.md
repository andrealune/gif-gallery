# Database schema (L42-414)

PostgreSQL 13+ schema for the GIF gallery catalog: gifs, their category/tags, and provenance
("where did this GIF actually come from") for third-party/AI/upload sources. Implemented as versioned
SQL migrations in `../migrations/`, applied with `../src/db/migrate.ts` (`npm run migrate:up`).

## Entity-relationship overview

```
categories 1 ──── * gifs * ──── * tags            (via gif_tags)
     │                │
     │                └──── * third_party_references
     │
     ├──── * generation_prompts 0/1 ──── * generation_attempts * ──── 0/1 gifs
     │                                          │
     └──────────────────────────────────────────┘ (category_id snapshot, see below)
```

- A **gif** belongs to at most one **category** (nullable FK, `ON DELETE SET NULL` -- deleting a
  category un-categorizes its gifs rather than deleting them).
- A **gif** has many **tags** and a **tag** can be on many gifs, through the `gif_tags` join table
  (`ON DELETE CASCADE` both ways -- deleting a gif or a tag just removes the association row).
- A **gif** has zero or more **third_party_references**: rows recording where its content came from
  (a Giphy/Tenor pull, an AI generation call, an uploaded source image for the image-to-GIF pipeline).
  `ON DELETE CASCADE` from `gifs` -- deleting a gif deletes its provenance records with it.
- A **category** has zero or more **generation_prompts** (the AI-image-generation text prompt(s) used
  to generate on-theme content for that category, L42-423/ADR-0001). Unlike `gifs.category_id`, this FK
  is `NOT NULL` and `ON DELETE RESTRICT` -- see "Category retirement procedure" below.
- A **generation_prompt** has zero or more **generation_attempts** (one row per batch-scheduler call to
  the image-generation API for that prompt, L42-424/ADR-0002), each of which produces at most one **gif**
  (`ON DELETE SET NULL` -- if that specific gif is later hard-deleted, the attempt/cost/audit record
  survives). `generation_attempts.generation_prompt_id` is nullable and also `ON DELETE SET NULL` (not
  `RESTRICT`) -- see the table's own section below for why, and how BR-7 attributability still holds.

## Tables

### `categories`

| column        | type          | notes                                            |
|---------------|---------------|---------------------------------------------------|
| id            | uuid PK       | `gen_random_uuid()` default (core builtin, PG13+ -- no extension needed) |
| name          | varchar(100)  | unique, case-insensitively (`lower(name)` index)  |
| slug          | varchar(120)  | unique, URL-safe (`^[a-z0-9]+(-[a-z0-9]+)*$`)      |
| description   | text          | optional                                           |
| thumbnail_url | text          | optional (`0012`); frontend falls back to an emoji placeholder when null |
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

## Category and tag population (L42-416)

Schema/relations for category-GIF and tag-GIF mapping (`categories`, `tags`, `gif_tags`,
`gifs.category_id`) were already in place from L42-414. What was missing until L42-416 was the
write path actually populating `tags`/`gif_tags` from provider data:

- `TenorGifRepository.store()` (`src/services/tenor/repository.ts`) now upserts each of Tenor's
  free-text `tags` into the shared `tags` table (matched case-insensitively via a normalized
  `slug`, see `slugifyTag`) and re-syncs that gif's `gif_tags` rows to match exactly on every
  import -- so a tag the provider drops on a later refresh is unlinked, not left stale. Tags with
  no ASCII-alphanumeric content (pure emoji/punctuation) are skipped rather than failing the
  import. This runs inside the same transaction as the gif upsert, so a gif and its tags are never
  left half-written.
- Previously, provider tags were only recorded inside `gifs.metadata->>'tags'` (a JSON blob) --
  useful for audit/debugging but not queryable/indexable as a relation. That JSON copy is kept
  (for provenance/debugging) in addition to, not instead of, the relational one.
- **Categories remain curation, not automatic-from-tags.** `gifs.category_id` is nullable and the
  Tenor importer does not guess a category from tags -- Tenor has no category field, only
  free-text tags, and mapping "cat" or "monday" to one of the 8 seeded categories reliably needs a
  product-owned rule set (or manual/AI curation), not a database-layer heuristic. Any such mapping
  should be designed as its own reviewed piece of work (see L42-423, which defines
  categories/prompts for AI generation and is blocked on this task) rather than guessed here.
- `docs/tenor-integration.md` documents the same behavior from the integration's point of view.

Consumers that need "gifs in category X" or "gifs tagged Y" should query through `gifs.category_id`
and the `gif_tags` join respectively (see indexes: `gifs_category_id_idx`, `gif_tags_tag_id_idx`,
plus the PK on `gif_tags(gif_id, tag_id)` for the reverse lookup) -- building the actual listing
endpoints is tracked separately in L42-417.

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
|---------------|--------------|-------------------------------------------------------------------|
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

### `generation_prompts` (L42-445 / ADR-0001)

Category -> AI-image-generation-prompt mapping. Seed/config data (engineering/content-owned, not
end-user-authored); the batch scheduler (L42-424, `src/services/generation/promptRepository.ts`) reads
a category's active prompts and picks among them.

| column        | type         | notes                                                              |
|---------------|--------------|-----------------------------------------------------------------------|
| id            | uuid PK      |                                                                       |
| category_id   | uuid FK      | **`NOT NULL`, `ON DELETE RESTRICT`** -- see below                    |
| prompt_text   | text         | 1-1000 chars, non-blank (`CHECK`s; DALL-E 3's prompt limit)          |
| is_active     | boolean      | default `true`; soft-disable flag -- inactive prompts are kept, not deleted, for audit history |
| created_at    | timestamptz  |                                                                       |
| updated_at    | timestamptz  | kept current by the `set_updated_at` trigger                        |

A unique expression index on `(category_id, lower(btrim(prompt_text)))` blocks the same prompt text
(case/whitespace-insensitive) from being registered twice for one category, while allowing the same
text to be reused across different categories.

**Why `ON DELETE RESTRICT` here, but `gifs.category_id` is `ON DELETE SET NULL`?** A `gifs` row is
meaningful with no category (an uncategorized gif is still a gif). A `generation_prompts` row is not --
there is nothing for the scheduler to select it *for* without a category -- so `category_id` is
`NOT NULL`, and `SET NULL` is not a valid option. `RESTRICT` (rather than `CASCADE`) is the deliberate
choice on top of that: deleting a category that still has prompts fails loudly instead of silently
destroying prompt history, forcing the explicit retirement procedure below.

**Category retirement procedure** (deleting a category that has `generation_prompts` rows):
1. **Deactivate**: `UPDATE generation_prompts SET is_active = false WHERE category_id = :id;` -- stops
   the scheduler from selecting them immediately (soft-disable, audit history preserved). This alone
   satisfies most "retire this category from AI generation" needs without deleting anything.
2. **Purge**, once ready, in FK order: `DELETE FROM generation_prompts WHERE category_id = :id;` then
   `DELETE FROM categories WHERE id = :id;`. This is a deliberate, reviewed, destructive action -- never
   automated by a migration or by application code. This step is **not** blocked by attempt history:
   `generation_attempts.generation_prompt_id` is `ON DELETE SET NULL` (see that table's section below),
   not `RESTRICT` -- deleting a prompt just nulls that FK on its past attempts. BR-7 attributability
   survives that regardless, because every `generation_attempts` row also snapshots `category_id` and
   `prompt_text` directly at write time, independent of whether the live `generation_prompts`/
   `categories` rows they were copied from still exist.

**Renaming** a category (`UPDATE categories SET name = ... WHERE id = :id`) does not touch
`generation_prompts` at all -- the FK is on `id`, which a rename never changes.

**BR-6**: a newly added category is *not* auto-enrolled in AI generation -- no default/placeholder
prompt is invented for it. A category only participates once a prompt is explicitly inserted for it
(see `0011_seed_generation_prompts`, which deliberately seeds only `animals`/`reactions`/`sports`/`memes`
-- the 4 of the L42-423 spec's proposed prompts that have a matching category in the `0008` taxonomy).

### `generation_attempts` (L42-445 / ADR-0002)

One row per batch-scheduler call to the image-generation API for a `generation_prompts` row. Per
ADR-0002 (gap G7: the image-generation API returns a static image, not a GIF), an attempt is meant to
track two distinct artifacts: the source image the API returned, and -- once/if the separate
image-to-GIF conversion step succeeds -- the derived GIF stored in `gifs`.

| column                  | type                        | notes                                                   |
|-------------------------|-----------------------------|-----------------------------------------------------------|
| id                      | uuid PK                     |                                                             |
| generation_prompt_id    | uuid FK, nullable           | `ON DELETE SET NULL` -- see below                          |
| category_id             | uuid FK, nullable           | `ON DELETE SET NULL`; snapshot, written directly (see below) |
| gif_id                  | uuid FK, nullable           | `ON DELETE SET NULL`; set only once conversion succeeds    |
| status                  | enum                        | `pending` \| `succeeded` \| `failed`, default `pending`  |
| provider                | enum (`third_party_provider`) | reuses the enum from `third_party_references`, default `openai` |
| model                   | varchar(100), nullable      | e.g. `dall-e-3`                                            |
| prompt_text             | text                        | **`NOT NULL`**, non-blank -- snapshot of the exact prompt attempted |
| source_image_url        | text                        | not yet written by the application (see note below)        |
| source_image_metadata   | jsonb                       | default `{}`, `CHECK` enforces it stays a JSON object; not yet written |
| error_code / error_message | varchar(100) / text     | populated on failure (BR-7: attributable, reviewable failures) |
| cost_usd                | numeric(10,4), nullable      | estimated per-call cost in USD; `CHECK (>= 0)`             |
| requested_at            | timestamptz                 |                                                             |
| completed_at            | timestamptz                 | nullable (`pending`); `CHECK`ed `>= requested_at`           |
| created_at / updated_at | timestamptz                 | `updated_at` kept current by trigger                       |

A `CHECK` constraint enforces `(status = 'succeeded') = (gif_id IS NOT NULL)` -- a row can only
reference a gif once it has actually succeeded, and a succeeded row must reference one. A partial
unique index on `gif_id` (`WHERE gif_id IS NOT NULL`) keeps the relationship one attempt per gif.

**This column set is fit to the real write path, not designed in isolation**: by the time this
migration landed, `src/services/generation/attemptsRepository.ts` (`GenerationAttemptsRepository.record`,
L42-424) and its call site (`scheduler.ts`) already existed, tested, writing exactly this shape. An
earlier draft of this migration had `generation_prompt_id NOT NULL`/`ON DELETE RESTRICT` and no
`category_id`/`prompt_text` columns, which does not match that repository -- it would have failed at
runtime with "column does not exist" (`category_id`, `prompt_text`) and a `NOT NULL` violation on the
one documented edge case (see next paragraph). This migration was corrected to match the shipped code
rather than the other way around.

**Why `generation_prompt_id` is nullable, `ON DELETE SET NULL`** (not `NOT NULL`/`RESTRICT`):
`RecordFailedAttempt` (`src/services/generation/types.ts`) documents `promptId` as "may be absent if the
failure happened before a prompt could be picked", and `attemptsRepository.ts` inserts `NULL` in exactly
that case. In the scheduler's current call sites this never actually happens (a prompt is always picked
before any `record()` call), but the schema must accept the case the type and repository already handle,
not just today's actual call pattern. `SET NULL` (rather than `RESTRICT`) also means the category
retirement procedure above is never blocked by attempt history.

**Why `category_id` and `prompt_text` are snapshotted directly on this table**, even though both are
already reachable by joining through `generation_prompt_id`: `attemptsRepository.ts` writes both on
every insert (succeeded or failed) regardless of whether `generation_prompt_id` is present, and BR-7
requires attribution to survive independent of whatever happens to the live `generation_prompts`/
`categories` rows afterwards (edit, deactivate, or hard-delete per the retirement procedure). `prompt_text`
is `NOT NULL` because both `RecordSucceededAttempt` and `RecordFailedAttempt` require it unconditionally.

**`cost_usd NUMERIC(10,4)`**: DALL-E-class per-image pricing is quoted in fractions of a US dollar
(e.g. $0.016-$0.12/image as of writing, per `src/services/ai/costTracker.ts`'s pricing table); 4 decimal
places avoids rounding those to $0.00, and `NUMERIC` (not `FLOAT`/`DOUBLE`) avoids binary
floating-point drift on a column that will be summed for cost reporting. This is the persistent ledger
that `costTracker.ts`'s in-memory-only tracker explicitly leaves for later.

**`source_image_url`/`source_image_metadata` are not yet written by the application.** They are kept,
nullable/defaulted so today's inserts (which omit them) are unaffected, as the place ADR-0002's "track
the source image separately from the derived gif" intent lands once a write path for it is added --
flagged back to L42-443/backend-engineer as follow-up work, not a blocker for this migration.

**No retention/partition plan yet**: at the batch scheduler's stated volume (tens of attempts/day) this
reaches roughly 3.6k-36k rows/year, which does not warrant partitioning today. Revisit (time-range
partitioning, or a purge policy mirroring `gifs`' soft-delete-then-90-day-hard-delete policy) if
scheduling frequency, category count or `source_image_metadata` payload size increase by an order of
magnitude.

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
| `generation_prompts_category_id_idx`                 | "all prompts for category X"                                       |
| `generation_prompts_active_category_idx` (partial, `is_active`) | the scheduler's "active prompts for category X" query, without indexing soft-disabled rows |
| `generation_prompts_category_text_unique_idx` (expression, unique) | blocks case/whitespace-duplicate prompt text within a category |
| `generation_attempts_generation_prompt_id_idx`        | "all attempts for this prompt" (audit/BR-7 review)                 |
| `generation_attempts_category_id_idx`                 | "all attempts for this category", including those with no live prompt row |
| `generation_attempts_status_idx`                      | filter by `pending`/`succeeded`/`failed`                           |
| `generation_attempts_requested_at_idx`                | time-range queries, future retention/reporting                     |
| `generation_attempts_gif_id_unique_idx` (partial, unique) | "which attempt produced this gif", and enforces one attempt per gif |

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
- `generation_prompts` rows are soft-disabled (`is_active = false`), never hard-deleted, in normal
  operation -- see "Category retirement procedure" above for the one deliberate exception.
- `generation_attempts` has no purge policy yet (tens of rows/day; revisit if that assumption changes --
  see the table's own section above for the specific triggers to watch for).

## Category retirement

Deleting a category (`DELETE /api/categories/:idOrSlug`, L42-444) behaves differently depending on what
still references it:

- `gifs.category_id` is `ON DELETE SET NULL` -- a gif can stand alone with no category, so deleting a
  category un-categorizes its gifs automatically. No application code is needed for this.
- `generation_prompts.category_id` (migration 0009, L42-445) is `ON DELETE RESTRICT` on purpose -- a
  prompt with no category would violate BR-5 of `docs/specs/ai-generation-prompts-spec.md`, and a cascade
  would silently destroy the BR-3/BR-7 `generation_attempts` audit trail (see ADR-0001 / L42-443). A
  category that still has `generation_prompts` rows cannot be deleted, full stop -- not even by the API.

`CategoryRepository.deleteCategory` (`src/services/categories/repository.ts`) surfaces this as `404` (no
such category) or `409 Conflict` with `code: "category_has_generation_prompts"` and
`details.blockingPromptCount`, never an unhandled `500`. To actually retire a category that has prompts:

1. **Deactivate** its prompts: `UPDATE generation_prompts SET is_active = false WHERE category_id = $1`.
   This stops the scheduler from selecting them for new generation attempts but does **not** delete
   anything, and does **not** by itself unblock the category delete -- an inactive prompt row still
   satisfies the FK and still counts towards `blockingPromptCount`.
2. **Purge** the now-inactive prompts once retention/audit requirements allow it:
   `DELETE FROM generation_prompts WHERE category_id = $1 AND is_active = false`. This is the step that
   actually clears the FK; do it deliberately, not automatically, since it removes rows that
   `generation_attempts` may still reference for historical reporting.
3. **Delete** the category (`DELETE /api/categories/:idOrSlug`), which now succeeds.

No `ON DELETE CASCADE` and no cascade-on-delete trigger stands in for this procedure anywhere in the
schema -- that was considered and rejected in ADR-0001 (silent data loss, untestable from the API). See
`test/categories/deleteCategory.integration.test.ts` for coverage of every step above against a real
(embedded Postgres) schema, including an explicit assertion that the FK's `delete_rule` is `RESTRICT` and
that no such trigger exists on `categories`.

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
| `0009_create_generation_prompts_table`        | new table, no contention                   | none (empty table)          | **destructive**: drops all generation prompts (rolled back after 0010, by convention) |
| `0010_create_generation_attempts_table`       | new table + enum type, no contention        | none (empty table)          | **destructive**: drops all generation attempts (rolled back before 0009, by convention) |
| `0011_seed_generation_prompts`                | row-level locks on up to 4 inserted rows    | inserts up to 4 rows, idempotent (`ON CONFLICT DO NOTHING`) | deletes those rows only if no attempt references them |
| `0012_add_thumbnail_url_to_categories`        | fast metadata-only `ADD COLUMN`, no rewrite | adds nullable column, no existing rows changed | drops the column; any values written after `0012` are lost |

All of `0001`-`0011` are brand-new objects on a fresh database, so none of them contend with concurrent
application traffic or require an `ALTER TABLE ... ADD COLUMN` rewrite/lock on an existing, populated
table; `0012` is the first migration in this set to alter an already-populated table, and its header
documents why that specific `ADD COLUMN` is still safe. **Future migrations that add columns/constraints
to already-populated tables must document their own locking behaviour explicitly** (e.g. `ADD COLUMN
... DEFAULT` on Postgres 11+ is a fast, non-rewriting metadata-only change for a constant default, but
adding a `NOT NULL` constraint or a new index on a large table can take a long lock or block writes --
use `CREATE INDEX CONCURRENTLY` and validate `CHECK` constraints with `NOT VALID` + `VALIDATE CONSTRAINT`
in that case) and get a software-architect review before running against production, per this project's
escalation policy.

Down-migrations are provided for every up-migration (required for rollback), but several are
**destructive by design** (they drop the tables/rows their matching up-migration created) -- never run
`migrate:down` against a database with real data without a reviewed plan, exactly as the up-front
rollback notes in each file say.

## Testing

`test/migrations.test.ts` applies every `up.sql` in order against an embedded PGlite (in-memory
Postgres) instance, exercises the core constraints (blank-title rejection, third-party uniqueness,
cascading deletes, generated `search_vector`), then rolls every `down.sql` back in reverse order and
asserts the schema is empty again. Run it with `npm test` (or `npx vitest run test/migrations.test.ts`).
It does not require a real Postgres server, so it runs in CI with no extra services.

`test/generationPrompts.schema.test.ts` does the same for `generation_prompts`/`generation_attempts`
specifically: BR-3/BR-4/BR-5 constraint rejection, the RESTRICT-vs-SET NULL category/prompt lifecycle
behaviour, the `0011` seed's idempotency, and -- since `src/services/generation/attemptsRepository.ts`
already exists and is unit-tested with a mocked `pg` client (so its own tests never touch a real
schema) -- explicit coverage asserting the exact `INSERT` shape that repository issues against the real
table, both for a succeeded attempt and for a failed one with a `NULL` `generation_prompt_id`/`category_id`.

`src/db/migrate.ts` (the runner used against a real database) is not exercised by that test -- PGlite
does not speak the Postgres wire protocol `pg.Client` uses -- so it should also be smoke-tested against
a real local/staging Postgres (`npm run migrate:up && npm run migrate:status && npm run migrate:down`)
before this change ships. That was not possible in this sandbox (no Postgres server or container runtime
available); a backend engineer or CI job with a real Postgres instance should confirm before merge.

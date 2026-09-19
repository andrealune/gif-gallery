/**
 * `gifs` search index schema: field mapping + settings, and the versioned
 * index/alias naming scheme used by `pipeline.ts`.
 *
 * Naming scheme (index aliasing, so a full reindex never causes downtime):
 *   - Real indices are versioned:      gifs_v1, gifs_v2, ...
 *   - The application only ever talks to the alias: gifs
 *   - `pipeline.ts#runReindexPipeline` builds the next version fully, then
 *     atomically repoints the alias to it, then (optionally) prunes older
 *     versions. Rollback = repoint the alias back to the previous version
 *     (see docs/elasticsearch.md).
 */
export const GIFS_ALIAS_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export function versionedIndexName(alias: string, version: number): string {
  return `${alias}_v${version}`;
}

export function parseIndexVersion(alias: string, indexName: string): number | null {
  const match = indexName.match(new RegExp(`^${alias}_v(\\d+)$`));
  return match ? Number(match[1]) : null;
}

/**
 * Field mapping for the `gifs` index. Deliberately mirrors the columns the
 * issue calls out (title, description, tags, category) plus the handful of
 * fields the search API needs to render a result without a second database
 * round trip.
 *
 * - `title`/`description`/`category.name` use the `english` analyzer -- the
 *   same choice already made for Postgres' `gifs.search_vector` (see
 *   migrations/0005), so relevance behaviour (stemming, stopwords) is
 *   consistent between the two.
 * - `tags` is `keyword` (exact match / faceting, e.g. "tag:cat") with a
 *   `.text` multi-field for free-text matching on tag words.
 * - `url`/`thumbnailUrl` are stored but `index: false` -- never searched on,
 *   only returned, so they cost nothing at query time.
 */
export const GIFS_INDEX_MAPPING = {
  dynamic: 'strict',
  properties: {
    id: { type: 'keyword' },
    title: {
      type: 'text',
      analyzer: 'english',
      fields: { keyword: { type: 'keyword', ignore_above: 256 } },
    },
    description: { type: 'text', analyzer: 'english' },
    tags: {
      type: 'keyword',
      fields: { text: { type: 'text', analyzer: 'english' } },
    },
    category: {
      properties: {
        id: { type: 'keyword' },
        name: {
          type: 'text',
          analyzer: 'english',
          fields: { keyword: { type: 'keyword', ignore_above: 120 } },
        },
        slug: { type: 'keyword' },
      },
    },
    status: { type: 'keyword' },
    source: { type: 'keyword' },
    url: { type: 'keyword', index: false },
    thumbnailUrl: { type: 'keyword', index: false },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
  },
} as const;

export interface GifsIndexSettingsOptions {
  shards: number;
  replicas: number;
}

/**
 * Index settings. A single primary shard is deliberate: at 10k-100k
 * documents (a few tens of MB, per the issue's target scale) one shard is
 * both sufficient and faster to query than splitting a small index further
 * -- more shards only adds coordination overhead at this size. Replicas are
 * configurable (0 for a single-node local dev cluster, >=1 in production for
 * availability/read throughput).
 */
export function buildGifsIndexSettings(options: GifsIndexSettingsOptions): Record<string, unknown> {
  return {
    number_of_shards: options.shards,
    number_of_replicas: options.replicas,
  };
}

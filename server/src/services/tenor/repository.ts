import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { pool } from '../../db/pool';
import type { TenorGif } from './types';

export type StoreOutcome = 'inserted' | 'updated';

type TransactionClient = Pick<PoolClient, 'query'>;
type DatabasePool = Pick<Pool, 'connect'>;

export class TenorGifRepository {
  constructor(private readonly database: DatabasePool = pool) {}

  async store(gif: TenorGif): Promise<StoreOutcome> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      // Serializes competing imports of the same provider ID, including across processes.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`tenor:${gif.id}`]);
      const existing = await query<{ gif_id: string }>(
        client,
        `SELECT gif_id FROM third_party_references
         WHERE provider = 'tenor' AND external_id = $1
         FOR UPDATE`,
        [gif.id]
      );

      let outcome: StoreOutcome;
      let gifId: string;
      if (existing.rows[0]) {
        gifId = existing.rows[0].gif_id;
        outcome = await this.update(client, gifId, gif);
      } else {
        gifId = await this.insert(client, gif);
        outcome = 'inserted';
      }

      // Relational tagging: mirror the provider's tags onto `tags`/`gif_tags` (not just the
      // `metadata` JSON blob) so gifs are queryable/filterable by tag -- see
      // docs/database-schema.md. Re-syncs on every import so a gif whose tags changed
      // upstream (or that dropped a tag entirely) doesn't keep stale associations.
      await this.syncTags(client, gifId, gif.tags);

      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async insert(client: TransactionClient, gif: TenorGif): Promise<string> {
    const inserted = await query<{ id: string }>(
      client,
      `INSERT INTO gifs
         (source, title, description, url, thumbnail_url, width, height,
          file_size_bytes, duration_ms, mime_type, metadata)
       VALUES ('tenor', $1, $2, $3, $4, $5, $6, $7, $8, 'image/gif', $9::jsonb)
       RETURNING id`,
      gifParams(gif)
    );
    const gifId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO third_party_references
         (gif_id, provider, external_id, external_url, attribution, raw_metadata)
       VALUES ($1, 'tenor', $2, $3, 'Powered By Tenor', $4::jsonb)`,
      [gifId, gif.id, gif.itemUrl, JSON.stringify(gif.raw)]
    );
    return gifId;
  }

  private async update(client: TransactionClient, gifId: string, gif: TenorGif): Promise<StoreOutcome> {
    await client.query(
      `UPDATE gifs SET
         title = $1, description = $2, url = $3, thumbnail_url = $4,
         width = $5, height = $6, file_size_bytes = $7, duration_ms = $8,
         mime_type = 'image/gif', metadata = $9::jsonb
       WHERE id = $10`,
      [...gifParams(gif), gifId]
    );
    await client.query(
      `UPDATE third_party_references SET
         external_url = $1, attribution = 'Powered By Tenor',
         raw_metadata = $2::jsonb, fetched_at = now()
       WHERE provider = 'tenor' AND external_id = $3`,
      [gif.itemUrl, JSON.stringify(gif.raw), gif.id]
    );
    return 'updated';
  }

  /**
   * Upserts each provider tag into the shared `tags` table (by slug, case-insensitively) and
   * makes `gif_tags` match the given list exactly: adds missing associations, removes ones for
   * tags the provider no longer reports for this gif. Blank/unslug-able tags (e.g. pure
   * punctuation or emoji) are skipped rather than failing the whole import.
   */
  private async syncTags(client: TransactionClient, gifId: string, tagNames: readonly string[]): Promise<void> {
    const tagIds: string[] = [];
    const seenSlugs = new Set<string>();

    for (const raw of tagNames) {
      const name = raw.trim().slice(0, 100);
      const slug = slugifyTag(name);
      if (!name || !slug || seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);

      // ON CONFLICT ... DO UPDATE (no-op) is a portable way to get RETURNING id back for both
      // the newly-inserted row and a pre-existing one, in a single round-trip.
      const upserted = await query<{ id: string }>(
        client,
        `INSERT INTO tags (name, slug)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET slug = tags.slug
         RETURNING id`,
        [name.slice(0, 50), slug]
      );
      tagIds.push(upserted.rows[0].id);
    }

    // Drop associations for tags no longer present (works even when tagIds is empty: `<> ALL`
    // over an empty array is true for every row, so this clears all associations).
    await client.query(
      `DELETE FROM gif_tags WHERE gif_id = $1 AND tag_id <> ALL($2::uuid[])`,
      [gifId, tagIds]
    );

    if (tagIds.length > 0) {
      await client.query(
        `INSERT INTO gif_tags (gif_id, tag_id)
         SELECT $1, unnest($2::uuid[])
         ON CONFLICT (gif_id, tag_id) DO NOTHING`,
        [gifId, tagIds]
      );
    }
  }
}

/**
 * Normalizes a free-text tag into the URL-safe slug format `tags.slug` requires
 * (`^[a-z0-9]+(-[a-z0-9]+)*$`): lowercased, diacritics stripped, runs of anything else collapsed
 * to a single hyphen, no leading/trailing hyphen. Returns '' for tags with no ASCII
 * alphanumerics (e.g. an emoji-only tag) -- callers should skip those rather than insert a
 * blank/all-hyphen slug.
 */
export function slugifyTag(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

function gifParams(gif: TenorGif): unknown[] {
  const title = (gif.title || gif.contentDescription || `Tenor GIF ${gif.id}`).trim().slice(0, 255);
  return [
    title || `Tenor GIF ${gif.id}`.slice(0, 255),
    gif.contentDescription || null,
    gif.media.gif.url,
    gif.media.tinygif.url,
    gif.media.gif.dims[0],
    gif.media.gif.dims[1],
    Math.round(gif.media.gif.size),
    Math.round(gif.media.gif.duration * 1000),
    JSON.stringify({ provider: 'tenor', tags: gif.tags, shareUrl: gif.shareUrl, created: gif.created }),
  ];
}

function query<T extends QueryResultRow>(
  client: TransactionClient,
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return client.query<T>(text, params);
}

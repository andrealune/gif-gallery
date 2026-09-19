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

      const outcome = existing.rows[0]
        ? await this.update(client, existing.rows[0].gif_id, gif)
        : await this.insert(client, gif);
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async insert(client: TransactionClient, gif: TenorGif): Promise<StoreOutcome> {
    const inserted = await query<{ id: string }>(
      client,
      `INSERT INTO gifs
         (source, title, description, url, thumbnail_url, width, height,
          file_size_bytes, duration_ms, mime_type, metadata)
       VALUES ('tenor', $1, $2, $3, $4, $5, $6, $7, $8, 'image/gif', $9::jsonb)
       RETURNING id`,
      gifParams(gif)
    );
    await client.query(
      `INSERT INTO third_party_references
         (gif_id, provider, external_id, external_url, attribution, raw_metadata)
       VALUES ($1, 'tenor', $2, $3, 'Powered By Tenor', $4::jsonb)`,
      [inserted.rows[0].id, gif.id, gif.itemUrl, JSON.stringify(gif.raw)]
    );
    return 'inserted';
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

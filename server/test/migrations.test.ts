/**
 * Executes every migration's up.sql (in order) against an embedded, in-memory
 * Postgres (PGlite) and asserts the resulting schema, then runs every
 * down.sql in reverse order and asserts the database is back to empty.
 *
 * This is a schema-correctness test, not a test of `src/db/migrate.ts`
 * itself (PGlite does not speak the `pg` wire protocol that runner talks
 * to a real server over) -- it exists so a broken migration is caught in
 * CI without needing a live Postgres instance.
 */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

function loadMigrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.replace(/\.up\.sql$/, ''))
    .sort((a, b) => a.localeCompare(b));
}

function readSql(name: string, direction: 'up' | 'down'): string {
  return readFileSync(path.join(MIGRATIONS_DIR, `${name}.${direction}.sql`), 'utf8');
}

describe('database migrations', () => {
  const names = loadMigrationNames();
  let db: PGlite;

  beforeAll(() => {
    db = new PGlite();
  });

  afterAll(async () => {
    await db.close();
  });

  it('found at least one migration to test', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it('applies every up.sql in order without error', async () => {
    for (const name of names) {
      await db.exec(readSql(name, 'up'));
    }
  });

  it('creates the expected core tables', async () => {
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tableNames = result.rows.map((r) => r.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining(['categories', 'tags', 'gifs', 'gif_tags', 'third_party_references'])
    );
  });

  it('seeds the default categories', async () => {
    const result = await db.query<{ count: string }>('SELECT count(*)::text FROM categories');
    expect(Number(result.rows[0].count)).toBeGreaterThan(0);
  });

  it('generates the gifs.search_vector column and enforces core constraints', async () => {
    const categoryResult = await db.query<{ id: string }>(
      `INSERT INTO categories (name, slug) VALUES ('Test Category', 'test-category') RETURNING id`
    );
    const categoryId = categoryResult.rows[0].id;

    const gifResult = await db.query<{ id: string }>(
      `INSERT INTO gifs (source, title, description, url, category_id)
       VALUES ('upload', 'Dancing cat', 'A cat dancing to music', 'https://example.com/cat.gif', $1)
       RETURNING id, search_vector::text AS search_vector`,
      [categoryId]
    );
    expect(gifResult.rows[0].id).toBeTruthy();

    const searchResult = await db.query<{ id: string }>(
      `SELECT id FROM gifs WHERE search_vector @@ to_tsquery('english', 'dancing')`
    );
    expect(searchResult.rows).toHaveLength(1);

    // A blank title must be rejected.
    await expect(
      db.query(`INSERT INTO gifs (source, title, url) VALUES ('upload', '   ', 'https://example.com/x.gif')`)
    ).rejects.toThrow();
  });

  it('enforces the third-party reference uniqueness constraint', async () => {
    const gifResult = await db.query<{ id: string }>(
      `INSERT INTO gifs (source, title, url) VALUES ('giphy', 'Reference test', 'https://example.com/y.gif') RETURNING id`
    );
    const gifId = gifResult.rows[0].id;

    await db.query(
      `INSERT INTO third_party_references (gif_id, provider, external_id) VALUES ($1, 'giphy', 'abc123')`,
      [gifId]
    );

    await expect(
      db.query(`INSERT INTO third_party_references (gif_id, provider, external_id) VALUES ($1, 'giphy', 'abc123')`, [
        gifId,
      ])
    ).rejects.toThrow();
  });

  it('cascades gif deletion to gif_tags and third_party_references', async () => {
    const gifResult = await db.query<{ id: string }>(
      `INSERT INTO gifs (source, title, url) VALUES ('ai_generated', 'Cascade test', 'https://example.com/z.gif') RETURNING id`
    );
    const gifId = gifResult.rows[0].id;
    const tagResult = await db.query<{ id: string }>(
      `INSERT INTO tags (name, slug) VALUES ('cascade-tag', 'cascade-tag') RETURNING id`
    );
    const tagId = tagResult.rows[0].id;

    await db.query(`INSERT INTO gif_tags (gif_id, tag_id) VALUES ($1, $2)`, [gifId, tagId]);
    await db.query(`INSERT INTO third_party_references (gif_id, provider) VALUES ($1, 'openai')`, [gifId]);

    await db.query(`DELETE FROM gifs WHERE id = $1`, [gifId]);

    const remainingTags = await db.query('SELECT * FROM gif_tags WHERE gif_id = $1', [gifId]);
    const remainingRefs = await db.query('SELECT * FROM third_party_references WHERE gif_id = $1', [gifId]);
    expect(remainingTags.rows).toHaveLength(0);
    expect(remainingRefs.rows).toHaveLength(0);
    // The tag lookup row itself must survive (only the association is cascaded).
    const survivingTag = await db.query('SELECT * FROM tags WHERE id = $1', [tagId]);
    expect(survivingTag.rows).toHaveLength(1);
  });

  it('rolls back every down.sql in reverse order without error, back to an empty schema', async () => {
    for (const name of [...names].reverse()) {
      await db.exec(readSql(name, 'down'));
    }

    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    expect(result.rows).toHaveLength(0);
  });
});

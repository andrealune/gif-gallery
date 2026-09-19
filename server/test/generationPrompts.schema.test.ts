/**
 * Schema-correctness tests for the generation_prompts / generation_attempts
 * tables (migrations 0009-0011, L42-424) - each test names the business
 * rule (BR-n) or gap it pins from docs/specs/ai-generation-prompts-spec.md.
 * Runs against an embedded, in-memory Postgres (PGlite), same technique as
 * test/migrations.test.ts.
 *
 * Two `describe` blocks each share a single PGlite instance (created once
 * in `beforeAll`, migrated once) rather than one per test: PGlite is a full
 * WASM Postgres, and creating/migrating a fresh one per test (as opposed to
 * per describe block) was heavy enough to crash the test worker in this
 * project's sandboxed CI. The seed-only checks are kept in their own block
 * so the constraint-violation tests (which intentionally insert extra
 * prompts) can't change what they see.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

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

async function migrateUp(db: PGlite): Promise<void> {
  for (const name of loadMigrationNames()) {
    await db.exec(readSql(name, 'up'));
  }
}

async function categoryId(db: PGlite, slug: string): Promise<string> {
  const result = await db.query<{ id: string }>(`SELECT id FROM categories WHERE slug = $1`, [slug]);
  return result.rows[0].id;
}

describe('0011 seed_generation_prompts', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('only creates prompts for category slugs that exist in the 0008 taxonomy (BR-6)', async () => {
    const result = await db.query<{ slug: string }>(
      `SELECT c.slug FROM generation_prompts gp JOIN categories c ON c.id = gp.category_id ORDER BY c.slug`
    );
    const slugs = result.rows.map((r) => r.slug);
    expect(slugs).toEqual(['animals', 'memes', 'reactions', 'sports']);
    for (const slug of ['celebration', 'love', 'nature', 'technology', 'dance']) {
      expect(slugs).not.toContain(slug);
    }
  });

  it('seeds prompts that are active by default so the scheduler can select them', async () => {
    const result = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM generation_prompts WHERE NOT is_active`
    );
    expect(Number(result.rows[0].count)).toBe(0);
  });

  it('is idempotent (re-applying inserts nothing new)', async () => {
    const before = await db.query('SELECT count(*)::int AS count FROM generation_prompts');
    await db.exec(readSql('0011_seed_generation_prompts', 'up'));
    const after = await db.query('SELECT count(*)::int AS count FROM generation_prompts');
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

describe('generation_prompts / generation_attempts constraints', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('BR-4/FR-3: rejects prompt text over 1000 characters', async () => {
    const id = await categoryId(db, 'animals');
    await expect(
      db.query(`INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2)`, [id, 'x'.repeat(1001)])
    ).rejects.toThrow();
  });

  it('BR-4: rejects blank prompt text', async () => {
    const id = await categoryId(db, 'animals');
    await expect(
      db.query(`INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2)`, [id, '   '])
    ).rejects.toThrow();
  });

  it('FR-2: rejects a prompt referencing a non-existent category', async () => {
    await expect(
      db.query(`INSERT INTO generation_prompts (category_id, prompt_text) VALUES (gen_random_uuid(), 'A prompt')`)
    ).rejects.toThrow();
  });

  it('BR-5: rejects an intra-category duplicate prompt, case/whitespace-insensitively', async () => {
    const id = await categoryId(db, 'gaming');
    await db.query(`INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, 'A funny gamer moment')`, [
      id,
    ]);
    await expect(
      db.query(`INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, '  A FUNNY GAMER MOMENT  ')`, [
        id,
      ])
    ).rejects.toThrow();
  });

  it('allows the same prompt text to be reused across different categories', async () => {
    const gamingId = await categoryId(db, 'gaming');
    const otherId = await categoryId(db, 'other');
    await db.query(`INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, 'Shared text')`, [
      gamingId,
    ]);
    await expect(
      db.query(`INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, 'Shared text')`, [otherId])
    ).resolves.toBeTruthy();
  });

  it('BR-3: is_active defaults to true and can be soft-disabled without deleting the row', async () => {
    const id = await categoryId(db, 'anime');
    const inserted = await db.query<{ id: string; is_active: boolean }>(
      `INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, 'An anime prompt') RETURNING id, is_active`,
      [id]
    );
    expect(inserted.rows[0].is_active).toBe(true);

    await db.query(`UPDATE generation_prompts SET is_active = false WHERE id = $1`, [inserted.rows[0].id]);
    const stillThere = await db.query(`SELECT id FROM generation_prompts WHERE id = $1`, [inserted.rows[0].id]);
    expect(stillThere.rows).toHaveLength(1);
  });

  it('refuses to delete a category that still has prompt rows (ON DELETE RESTRICT)', async () => {
    const id = await categoryId(db, 'movies-tv');
    await db.query(`INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, 'A movie prompt')`, [id]);
    await expect(db.query(`DELETE FROM categories WHERE id = $1`, [id])).rejects.toThrow();
  });

  it('renaming a category leaves its generation_prompts rows untouched', async () => {
    const id = await categoryId(db, 'movies-tv');
    const existing = await db.query<{ id: string }>(`SELECT id FROM generation_prompts WHERE category_id = $1 LIMIT 1`, [
      id,
    ]);
    await db.query(`UPDATE categories SET name = 'Renamed Movies & TV' WHERE id = $1`, [id]);
    const stillLinked = await db.query<{ category_id: string }>(
      `SELECT category_id FROM generation_prompts WHERE id = $1`,
      [existing.rows[0].id]
    );
    expect(stillLinked.rows[0].category_id).toBe(id);
  });

  it('BR-7: a failed attempt must record an error message, a succeeded one must not', async () => {
    await expect(
      db.query(`INSERT INTO generation_attempts (status, prompt_text) VALUES ('failed', 'A prompt')`)
    ).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO generation_attempts (status, prompt_text, error_message) VALUES ('failed', 'A prompt', 'boom')`
      )
    ).resolves.toBeTruthy();
  });

  it('a succeeded attempt must reference the gif it produced', async () => {
    await expect(
      db.query(`INSERT INTO generation_attempts (status, prompt_text) VALUES ('succeeded', 'A prompt')`)
    ).rejects.toThrow();
  });

  it('an attempt survives its prompt being deleted (ON DELETE SET NULL)', async () => {
    const id = await categoryId(db, 'anime');
    const prompt = await db.query<{ id: string }>(
      `INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, 'A disposable prompt') RETURNING id`,
      [id]
    );
    const gif = await db.query<{ id: string }>(
      `INSERT INTO gifs (source, title, url) VALUES ('ai_generated', 'Test', 'https://example.com/g.gif') RETURNING id`
    );
    const attempt = await db.query<{ id: string }>(
      `INSERT INTO generation_attempts (generation_prompt_id, category_id, gif_id, status, prompt_text)
       VALUES ($1, $2, $3, 'succeeded', 'A disposable prompt') RETURNING id`,
      [prompt.rows[0].id, id, gif.rows[0].id]
    );

    await db.query(`DELETE FROM generation_prompts WHERE id = $1`, [prompt.rows[0].id]);

    const survived = await db.query<{ generation_prompt_id: string | null }>(
      `SELECT generation_prompt_id FROM generation_attempts WHERE id = $1`,
      [attempt.rows[0].id]
    );
    expect(survived.rows).toHaveLength(1);
    expect(survived.rows[0].generation_prompt_id).toBeNull();
  });
});

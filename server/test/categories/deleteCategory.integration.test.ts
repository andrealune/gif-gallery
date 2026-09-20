/**
 * Integration coverage for L42-444 (category delete/retire vs. the `generation_prompts` FK)
 * against a real (embedded, PGlite) Postgres schema - not just mocked queries, so the actual
 * SQLSTATE 23503 / constraint-name behaviour is exercised end to end.
 *
 * `generation_prompts` (migration 0009, by the Database Engineer per L42-445/ADR-0001) is now
 * merged, so this applies the real migrations directory as-is (currently 0001-0012) rather than
 * a stand-in table. The FK this test exercises is exactly
 * `generation_prompts.category_id REFERENCES categories(id) ON DELETE RESTRICT`, with Postgres's
 * default constraint name `generation_prompts_category_id_fkey`, which is what
 * `src/services/categories/repository.ts` matches on.
 */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CategoryRepository } from '../../src/services/categories/repository';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

function loadMigrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.replace(/\.up\.sql$/, ''))
    .sort((a, b) => a.localeCompare(b));
}

type Row = Record<string, unknown>;

describe('category delete/retire vs. generation_prompts (L42-444)', () => {
  let db: PGlite;
  let repo: CategoryRepository;

  beforeEach(async () => {
    db = new PGlite();
    for (const name of loadMigrationNames()) {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, `${name}.up.sql`), 'utf8'));
    }

    // Adapts PGlite's `query` (returns `{ rows }`) to the `Pick<Pool, 'query'>` shape
    // `CategoryRepository` expects from `pg`.
    repo = new CategoryRepository({
      query: (async (text: string, params?: unknown[]) => {
        const result = await db.query(text, params as unknown[]);
        return result;
      }) as never,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  async function insertCategory(slug: string): Promise<string> {
    const result = await db.query<Row>(
      `INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`,
      [slug, slug]
    );
    return result.rows[0].id as string;
  }

  async function insertGif(categoryId: string): Promise<string> {
    const result = await db.query<Row>(
      `INSERT INTO gifs (source, title, category_id, url) VALUES ('upload', 'test gif', $1, 'https://example.com/g.gif')
       RETURNING id`,
      [categoryId]
    );
    return result.rows[0].id as string;
  }

  // `generation_prompts` has a unique index on (category_id, lower(btrim(prompt_text))) (BR-5),
  // so each prompt for a given category needs distinct text - `label` keeps callers' intent
  // readable while guaranteeing that.
  async function insertPrompt(categoryId: string, label: string, isActive = true): Promise<string> {
    const result = await db.query<Row>(
      `INSERT INTO generation_prompts (category_id, prompt_text, is_active) VALUES ($1, $2, $3) RETURNING id`,
      [categoryId, `${label} prompt for ${categoryId}`, isActive]
    );
    return result.rows[0].id as string;
  }

  async function categoryExists(id: string): Promise<boolean> {
    const result = await db.query<Row>('SELECT 1 FROM categories WHERE id = $1', [id]);
    return result.rows.length > 0;
  }

  it('deletes a category with no generation_prompts and no gifs', async () => {
    const id = await insertCategory('unused');

    await repo.deleteCategory(id);

    expect(await categoryExists(id)).toBe(false);
  });

  it('deletes a category with gifs but no prompts, and un-categorizes the gifs (SET NULL, unchanged)', async () => {
    const id = await insertCategory('with-gifs');
    const gifId = await insertGif(id);

    await repo.deleteCategory(id);

    expect(await categoryExists(id)).toBe(false);
    const gif = await db.query<Row>('SELECT category_id FROM gifs WHERE id = $1', [gifId]);
    expect(gif.rows[0].category_id).toBeNull();
  });

  it('returns a 409-shaped error with the exact blocking count when active prompts exist, and does not delete anything', async () => {
    const id = await insertCategory('animals-l42-444');
    await insertPrompt(id, 'first');
    await insertPrompt(id, 'second');
    await insertPrompt(id, 'third');

    await expect(repo.deleteCategory(id)).rejects.toMatchObject({
      status: 409,
      code: 'category_has_generation_prompts',
      blockingPromptCount: 3,
    });

    expect(await categoryExists(id)).toBe(true);
    const prompts = await db.query<Row>('SELECT COUNT(*)::int AS count FROM generation_prompts WHERE category_id = $1', [
      id,
    ]);
    expect(prompts.rows[0].count).toBe(3); // still there - not silently cascaded away
  });

  it('is refused by the database FK itself too (RESTRICT, not caught only in application code)', async () => {
    const id = await insertCategory('animals-fk-check');
    await insertPrompt(id, 'only');

    await expect(db.query('DELETE FROM categories WHERE id = $1', [id])).rejects.toMatchObject({
      // Postgres raises SQLSTATE 23001 (restrict_violation) for an explicit ON DELETE RESTRICT
      // FK, not 23503 (foreign_key_violation, used for the default NO ACTION) - see
      // ri_ReportViolation in ri_triggers.c. PGlite matches this real-Postgres behaviour.
      code: '23001',
    });
  });

  it('the retirement procedure: deactivating prompts deletes nothing and does not unblock the category delete', async () => {
    const id = await insertCategory('retiring');
    await insertPrompt(id, 'first');
    await insertPrompt(id, 'second');

    await db.query('UPDATE generation_prompts SET is_active = FALSE WHERE category_id = $1', [id]);

    const stillThere = await db.query<Row>('SELECT COUNT(*)::int AS count FROM generation_prompts WHERE category_id = $1', [
      id,
    ]);
    expect(stillThere.rows[0].count).toBe(2); // deactivating is not deleting

    await expect(repo.deleteCategory(id)).rejects.toMatchObject({
      status: 409,
      code: 'category_has_generation_prompts',
      blockingPromptCount: 2, // deactivated rows still block the delete until purged
    });
  });

  it('the retirement procedure: purging the deactivated prompts then lets the category delete succeed', async () => {
    const id = await insertCategory('retired');
    await insertPrompt(id, 'first');
    await insertPrompt(id, 'second');

    await db.query('UPDATE generation_prompts SET is_active = FALSE WHERE category_id = $1', [id]);
    await db.query('DELETE FROM generation_prompts WHERE category_id = $1 AND is_active = FALSE', [id]);

    await repo.deleteCategory(id);

    expect(await categoryExists(id)).toBe(false);
  });

  it('the generation_prompts.category_id FK is RESTRICT, not CASCADE, and has no cascade-on-delete trigger standing in for one', async () => {
    const rule = await db.query<Row>(
      `SELECT rc.delete_rule
       FROM information_schema.referential_constraints rc
       WHERE rc.constraint_name = 'generation_prompts_category_id_fkey'`
    );
    expect(rule.rows[0]?.delete_rule).toBe('RESTRICT');

    // `categories_set_updated_at` (migration 0002/0003) is expected and unrelated - it only
    // maintains `updated_at` on UPDATE. `information_schema.triggers` also excludes the internal,
    // FK-enforcement triggers Postgres attaches for the RESTRICT constraint itself, so this is
    // specifically "is there a DELETE trigger on categories", which is the cascade-workaround this
    // issue rules out.
    const deleteTriggers = await db.query<Row>(
      `SELECT trigger_name FROM information_schema.triggers
       WHERE event_object_table = 'categories' AND event_manipulation = 'DELETE'`
    );
    expect(deleteTriggers.rows).toEqual([]); // no trigger-based cascade workaround on categories
  });
});

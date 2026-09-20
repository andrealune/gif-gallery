/**
 * Schema-correctness tests for `generation_prompts` / `generation_attempts`
 * (migrations 0009-0011, L42-445 / ADR-0001), against the business rules in
 * docs/specs/ai-generation-prompts-spec.md (L42-423), and against the real
 * write path already implemented in src/services/generation (L42-424) --
 * see attemptsRepository.ts's tests, which pinned the exact column set this
 * file asserts against the schema itself.
 *
 * Same approach as test/migrations.test.ts: applies every up.sql (in order)
 * against an embedded, in-memory Postgres (PGlite), asserts constraints
 * directly against the database (not application code), and does not
 * require a live Postgres server.
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

describe('generation_prompts / generation_attempts schema (L42-445)', () => {
  let db: PGlite;

  async function categoryId(slug: string): Promise<string> {
    const result = await db.query<{ id: string }>('SELECT id FROM categories WHERE slug = $1', [slug]);
    if (result.rows.length === 0) throw new Error(`fixture category not found: ${slug}`);
    return result.rows[0].id;
  }

  beforeAll(async () => {
    db = new PGlite();
    for (const name of loadMigrationNames()) {
      await db.exec(readSql(name, 'up'));
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates generation_prompts and generation_attempts', async () => {
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    const tableNames = result.rows.map((r) => r.table_name);
    expect(tableNames).toEqual(expect.arrayContaining(['generation_prompts', 'generation_attempts']));
  });

  it('FR-3/BR-4: rejects prompt_text over 1000 characters', async () => {
    const id = await categoryId('animals');
    await expect(
      db.query('INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2)', [
        id,
        'x'.repeat(1001),
      ])
    ).rejects.toThrow();
  });

  it('accepts prompt_text at exactly the 1000 character boundary', async () => {
    const id = await categoryId('animals');
    const result = await db.query<{ id: string }>(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id',
      [id, 'x'.repeat(1000)]
    );
    expect(result.rows[0].id).toBeTruthy();
  });

  it('rejects blank (whitespace-only) prompt_text', async () => {
    const id = await categoryId('reactions');
    await expect(
      db.query('INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2)', [id, '   '])
    ).rejects.toThrow();
  });

  it('rejects empty-string prompt_text', async () => {
    const id = await categoryId('reactions');
    await expect(
      db.query('INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2)', [id, ''])
    ).rejects.toThrow();
  });

  it('FR-2/BR-5: rejects a category_id that does not exist in the taxonomy', async () => {
    await expect(
      db.query('INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2)', [
        '00000000-0000-0000-0000-000000000000',
        'A prompt for a category that does not exist',
      ])
    ).rejects.toThrow();
  });

  it('rejects a NULL category_id (a prompt cannot be uncategorized)', async () => {
    await expect(
      db.query('INSERT INTO generation_prompts (category_id, prompt_text) VALUES (NULL, $1)', [
        'A prompt with no category',
      ])
    ).rejects.toThrow();
  });

  it('rejects an intra-category duplicate prompt, case/whitespace-insensitively', async () => {
    const id = await categoryId('sports');
    await db.query('INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2)', [
      id,
      'A sports celebration scene',
    ]);
    await expect(
      db.query('INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2)', [
        id,
        '  A SPORTS celebration scene  ',
      ])
    ).rejects.toThrow();
  });

  it('allows the same prompt text to be reused across different categories', async () => {
    const animalsId = await categoryId('animals');
    const memesId = await categoryId('memes');
    const text = 'A shared prompt text used for two different categories';
    await db.query('INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2)', [
      animalsId,
      text,
    ]);
    const result = await db.query(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id',
      [memesId, text]
    );
    expect(result.rows).toHaveLength(1);
  });

  it('BR-3: is_active defaults to true, and a soft-disabled prompt is not deleted', async () => {
    const id = await categoryId('animals');
    const inserted = await db.query<{ id: string; is_active: boolean }>(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id, is_active',
      [id, 'Defaults check: is_active should start true']
    );
    expect(inserted.rows[0].is_active).toBe(true);

    await db.query('UPDATE generation_prompts SET is_active = false WHERE id = $1', [inserted.rows[0].id]);
    const stillThere = await db.query('SELECT is_active FROM generation_prompts WHERE id = $1', [
      inserted.rows[0].id,
    ]);
    expect(stillThere.rows).toHaveLength(1);
    expect(stillThere.rows[0].is_active).toBe(false);
  });

  it('keeps updated_at current on UPDATE via the shared trigger', async () => {
    const id = await categoryId('reactions');
    const inserted = await db.query<{ id: string; updated_at: string }>(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id, updated_at',
      [id, 'Trigger check prompt text']
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const updated = await db.query<{ updated_at: string }>(
      'UPDATE generation_prompts SET prompt_text = $2 WHERE id = $1 RETURNING updated_at',
      [inserted.rows[0].id, 'Trigger check prompt text, edited']
    );
    expect(new Date(updated.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(inserted.rows[0].updated_at).getTime()
    );
  });

  it('category lifecycle: deleting a category that has no prompts still succeeds (no FK to violate)', async () => {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO categories (name, slug) VALUES ('Prompt-less Category', 'prompt-less-category') RETURNING id`
    );
    await expect(db.query('DELETE FROM categories WHERE id = $1', [inserted.rows[0].id])).resolves.toBeDefined();
  });

  it('category lifecycle: deleting a category that still has prompt rows is refused (RESTRICT)', async () => {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO categories (name, slug) VALUES ('RESTRICT Test Category', 'restrict-test-category') RETURNING id`
    );
    const id = inserted.rows[0].id;
    await db.query('INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2)', [
      id,
      'A prompt for a fixture category, used to prove RESTRICT blocks category deletion',
    ]);
    await expect(db.query('DELETE FROM categories WHERE id = $1', [id])).rejects.toThrow();
  });

  it('category lifecycle: deactivate-then-purge retirement succeeds once prompts are removed', async () => {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO categories (name, slug) VALUES ('Retiring Category', 'retiring-category') RETURNING id`
    );
    const id = inserted.rows[0].id;
    const prompt = await db.query<{ id: string }>(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id',
      [id, 'A prompt belonging to a category about to be retired']
    );

    // Step 1: deactivate.
    await db.query('UPDATE generation_prompts SET is_active = false WHERE category_id = $1', [id]);
    // Step 2: purge (generation_attempts.generation_prompt_id is ON DELETE
    // SET NULL, so no attempt history needs to be handled first) then delete
    // the category.
    await db.query('DELETE FROM generation_prompts WHERE category_id = $1', [id]);
    await expect(db.query('DELETE FROM categories WHERE id = $1', [id])).resolves.toBeDefined();

    const remaining = await db.query('SELECT id FROM generation_prompts WHERE id = $1', [prompt.rows[0].id]);
    expect(remaining.rows).toHaveLength(0);
  });

  it('renaming a category leaves its generation_prompts rows untouched', async () => {
    const id = await categoryId('memes');
    const before = await db.query<{ id: string; category_id: string }>(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id, category_id',
      [id, 'A prompt that must survive a category rename']
    );

    await db.query(`UPDATE categories SET name = 'Memes (renamed)' WHERE id = $1`, [id]);

    const after = await db.query<{ category_id: string }>('SELECT category_id FROM generation_prompts WHERE id = $1', [
      before.rows[0].id,
    ]);
    expect(after.rows[0].category_id).toBe(before.rows[0].category_id);
  });

  it('generation_attempts: matches the real write path (attemptsRepository.ts) - succeeded insert with generation_prompt_id, category_id, gif_id, prompt_text, model, cost_usd', async () => {
    const catId = await categoryId('animals');
    const prompt = await db.query<{ id: string }>(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id',
      [catId, 'Attempt write-path fixture prompt']
    );
    const gif = await db.query<{ id: string }>(
      `INSERT INTO gifs (source, title, url) VALUES ('ai_generated', 'Write-path fixture gif', 'https://example.com/write-path.gif') RETURNING id`
    );

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO generation_attempts
         (generation_prompt_id, category_id, gif_id, status, prompt_text, model, cost_usd)
       VALUES ($1, $2, $3, 'succeeded', $4, $5, $6)
       RETURNING id`,
      [prompt.rows[0].id, catId, gif.rows[0].id, 'Attempt write-path fixture prompt', 'dall-e-3', 0.04]
    );
    expect(inserted.rows[0].id).toBeTruthy();
  });

  it('generation_attempts: matches the real write path - failed insert tolerates a missing generation_prompt_id/category_id (attemptsRepository.ts coalesces both to NULL)', async () => {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO generation_attempts
         (generation_prompt_id, category_id, status, prompt_text, model, cost_usd, error_code, error_message)
       VALUES (NULL, NULL, 'failed', $1, NULL, NULL, $2, $3)
       RETURNING id, generation_prompt_id, category_id`,
      ['A cute cat', 'OpenAIRequestError', 'content policy violation']
    );
    expect(inserted.rows[0].id).toBeTruthy();
  });

  it('generation_attempts: rejects a NULL prompt_text (always supplied by RecordAttempt, both variants)', async () => {
    await expect(
      db.query(`INSERT INTO generation_attempts (status, prompt_text, error_code, error_message)
                 VALUES ('failed', NULL, 'Err', 'message')`)
    ).rejects.toThrow();
  });

  it('generation_attempts: rejects blank prompt_text', async () => {
    await expect(
      db.query(`INSERT INTO generation_attempts (status, prompt_text, error_code, error_message)
                 VALUES ('failed', '   ', 'Err', 'message')`)
    ).rejects.toThrow();
  });

  it('generation_attempts: enforces succeeded-implies-gif and non-succeeded-implies-no-gif', async () => {
    const catId = await categoryId('animals');
    const prompt = await db.query<{ id: string }>(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id',
      [catId, 'Attempt-status-consistency fixture prompt']
    );

    await expect(
      db.query(
        `INSERT INTO generation_attempts (generation_prompt_id, category_id, status, prompt_text) VALUES ($1, $2, 'succeeded', $3)`,
        [prompt.rows[0].id, catId, 'Attempt-status-consistency fixture prompt']
      )
    ).rejects.toThrow();

    const gif = await db.query<{ id: string }>(
      `INSERT INTO gifs (source, title, url) VALUES ('ai_generated', 'Attempt fixture gif', 'https://example.com/attempt.gif') RETURNING id`
    );
    await expect(
      db.query(
        `INSERT INTO generation_attempts (generation_prompt_id, category_id, status, prompt_text, gif_id) VALUES ($1, $2, 'pending', $3, $4)`,
        [prompt.rows[0].id, catId, 'Attempt-status-consistency fixture prompt', gif.rows[0].id]
      )
    ).rejects.toThrow();

    const ok = await db.query<{ id: string }>(
      `INSERT INTO generation_attempts (generation_prompt_id, category_id, status, prompt_text, gif_id, cost_usd)
       VALUES ($1, $2, 'succeeded', $3, $4, 0.0400) RETURNING id`,
      [prompt.rows[0].id, catId, 'Attempt-status-consistency fixture prompt', gif.rows[0].id]
    );
    expect(ok.rows[0].id).toBeTruthy();
  });

  it('generation_attempts: BR-7 - a failed attempt stays attributable to its prompt via the FK while the prompt still exists', async () => {
    const catId = await categoryId('sports');
    const prompt = await db.query<{ id: string }>(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id',
      [catId, 'BR-7 attributability fixture prompt']
    );
    await db.query(
      `INSERT INTO generation_attempts (generation_prompt_id, category_id, status, prompt_text, error_code, error_message)
       VALUES ($1, $2, 'failed', $3, 'content_policy_violation', 'rejected by provider')`,
      [prompt.rows[0].id, catId, 'BR-7 attributability fixture prompt']
    );

    const attempt = await db.query('SELECT status, error_code FROM generation_attempts WHERE generation_prompt_id = $1', [
      prompt.rows[0].id,
    ]);
    expect(attempt.rows[0]).toMatchObject({ status: 'failed', error_code: 'content_policy_violation' });
  });

  it('generation_attempts: BR-7 - deleting the referenced prompt sets generation_prompt_id to NULL (SET NULL) but the attempt row, and its category_id/prompt_text snapshot, survive', async () => {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO categories (name, slug) VALUES ('Attempt Snapshot Category', 'attempt-snapshot-category') RETURNING id`
    );
    const catId = inserted.rows[0].id;
    const prompt = await db.query<{ id: string }>(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id',
      [catId, 'Snapshot survives prompt deletion fixture prompt']
    );
    const attempt = await db.query<{ id: string }>(
      `INSERT INTO generation_attempts (generation_prompt_id, category_id, status, prompt_text, error_code, error_message)
       VALUES ($1, $2, 'failed', $3, 'Err', 'message') RETURNING id`,
      [prompt.rows[0].id, catId, 'Snapshot survives prompt deletion fixture prompt']
    );

    await db.query('DELETE FROM generation_prompts WHERE id = $1', [prompt.rows[0].id]);

    const after = await db.query<{ generation_prompt_id: string | null; category_id: string; prompt_text: string }>(
      'SELECT generation_prompt_id, category_id, prompt_text FROM generation_attempts WHERE id = $1',
      [attempt.rows[0].id]
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].generation_prompt_id).toBeNull();
    expect(after.rows[0].category_id).toBe(catId);
    expect(after.rows[0].prompt_text).toBe('Snapshot survives prompt deletion fixture prompt');
  });

  it('0011 seed: is idempotent - re-applying the seed inserts no additional rows', async () => {
    const before = await db.query<{ count: string }>('SELECT count(*)::text FROM generation_prompts');

    const seedUpSql = readSql('0011_seed_generation_prompts', 'up');
    await db.exec(seedUpSql);
    await db.exec(seedUpSql);

    const after = await db.query<{ count: string }>('SELECT count(*)::text FROM generation_prompts');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it('0011 seed: creates no prompt for a category slug that does not exist (movies-tv/anime/gaming/other, per BR-6/gap G1)', async () => {
    const noPromptSlugs = ['movies-tv', 'anime', 'gaming', 'other'];
    for (const slug of noPromptSlugs) {
      const id = await categoryId(slug);
      const result = await db.query('SELECT id FROM generation_prompts WHERE category_id = $1', [id]);
      expect(result.rows).toHaveLength(0);
    }
  });

  it('0011 seed: seeded exactly the 4 expected categories (animals, reactions, sports, memes)', async () => {
    const result = await db.query<{ slug: string }>(
      `SELECT c.slug FROM generation_prompts gp
       JOIN categories c ON c.id = gp.category_id
       WHERE gp.prompt_text IN (
         'Cute animated animal doing something funny, colorful, looping GIF style, family-friendly',
         'Exaggerated, comedic human facial expression reacting in surprise or joy, looping GIF style',
         'Dynamic, energetic moment from a fun sports scene, cartoon style, looping GIF style',
         'Absurd, comedic pop-culture-style scene, exaggerated expressions, looping GIF style'
       )
       ORDER BY c.slug`
    );
    expect(result.rows.map((r) => r.slug)).toEqual(['animals', 'memes', 'reactions', 'sports']);
  });

  it('generation_attempts: rejects a negative cost_usd', async () => {
    const catId = await categoryId('memes');
    const prompt = await db.query<{ id: string }>(
      'INSERT INTO generation_prompts (category_id, prompt_text) VALUES ($1, $2) RETURNING id',
      [catId, 'Negative cost rejection fixture prompt']
    );
    await expect(
      db.query(`INSERT INTO generation_attempts (generation_prompt_id, category_id, status, prompt_text, cost_usd) VALUES ($1, $2, 'failed', $3, -0.01)`, [
        prompt.rows[0].id,
        catId,
        'Negative cost rejection fixture prompt',
      ])
    ).rejects.toThrow();
  });
});

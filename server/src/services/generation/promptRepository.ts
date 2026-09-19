import type { Pool } from 'pg';
import { pool } from '../../db/pool';
import type { CategoryPromptStatus, GenerationPrompt } from './types';

/**
 * Read-only access to the category -> prompt mapping (`generation_prompts`,
 * migration 0009) the scheduler selects from. See
 * docs/specs/ai-generation-prompts-spec.md for BR-1/BR-2 (which this
 * class's two methods exist to satisfy).
 */
export class GenerationPromptRepository {
  constructor(private readonly database: Pick<Pool, 'query'> = pool) {}

  /**
   * Every category, with whether it currently has at least one active
   * prompt. BR-1: a category with none must be skipped (not errored) by the
   * caller.
   */
  async listCategoryPromptStatus(): Promise<CategoryPromptStatus[]> {
    const result = await this.database.query<{
      id: string;
      slug: string;
      name: string;
      has_active_prompt: boolean;
    }>(
      `SELECT c.id, c.slug, c.name,
              EXISTS (
                SELECT 1 FROM generation_prompts gp
                WHERE gp.category_id = c.id AND gp.is_active
              ) AS has_active_prompt
       FROM categories c
       ORDER BY c.slug`
    );
    return result.rows.map((r) => ({
      categoryId: r.id,
      categorySlug: r.slug,
      categoryName: r.name,
      hasActivePrompt: r.has_active_prompt,
    }));
  }

  /**
   * Picks one active prompt for the category at random. BR-2: repeated runs
   * are not required to reuse the same prompt when a category has more than
   * one. Returns `null` if the category has none active (e.g. a race with
   * another process deactivating the last one between calls) - callers must
   * treat that the same as BR-1 (skip, don't error).
   */
  async pickRandomActivePrompt(categoryId: string): Promise<GenerationPrompt | null> {
    const result = await this.database.query<{
      id: string;
      category_id: string;
      slug: string;
      prompt_text: string;
    }>(
      `SELECT gp.id, gp.category_id, c.slug, gp.prompt_text
       FROM generation_prompts gp
       JOIN categories c ON c.id = gp.category_id
       WHERE gp.category_id = $1 AND gp.is_active
       ORDER BY random()
       LIMIT 1`,
      [categoryId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { id: row.id, categoryId: row.category_id, categorySlug: row.slug, promptText: row.prompt_text };
  }
}

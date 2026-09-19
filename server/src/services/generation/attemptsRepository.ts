import type { Pool } from 'pg';
import { pool } from '../../db/pool';
import type { RecordAttempt } from './types';

/**
 * Write-only access to the `generation_attempts` audit trail (migration
 * 0010). Implements BR-7 from docs/specs/ai-generation-prompts-spec.md: a
 * failure must be attributable to a specific `generation_prompts` row.
 */
export class GenerationAttemptsRepository {
  constructor(private readonly database: Pick<Pool, 'query'> = pool) {}

  async record(attempt: RecordAttempt): Promise<string> {
    if (attempt.status === 'succeeded') {
      const result = await this.database.query<{ id: string }>(
        `INSERT INTO generation_attempts
           (generation_prompt_id, category_id, gif_id, status, prompt_text, model, cost_usd)
         VALUES ($1, $2, $3, 'succeeded', $4, $5, $6)
         RETURNING id`,
        [attempt.promptId, attempt.categoryId, attempt.gifId, attempt.promptText, attempt.model, attempt.costUsd]
      );
      return result.rows[0].id;
    }

    const result = await this.database.query<{ id: string }>(
      `INSERT INTO generation_attempts
         (generation_prompt_id, category_id, status, prompt_text, model, cost_usd, error_code, error_message)
       VALUES ($1, $2, 'failed', $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        attempt.promptId ?? null,
        attempt.categoryId ?? null,
        attempt.promptText,
        attempt.model ?? null,
        attempt.costUsd ?? null,
        attempt.errorCode,
        attempt.errorMessage,
      ]
    );
    return result.rows[0].id;
  }
}

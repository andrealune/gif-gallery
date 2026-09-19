import type { Pool, PoolClient } from 'pg';
import { pool } from '../../db/pool';
import type { StoreGeneratedGifInput } from './types';

type TransactionClient = Pick<PoolClient, 'query'>;
type DatabasePool = Pick<Pool, 'connect'>;

/**
 * Persists a successfully-generated GIF into the catalog (`gifs`) plus its
 * provenance (`third_party_references`, provider `openai`), transactionally
 * - the same two-table write pattern `TenorGifRepository` uses for
 * third-party imports (see `src/services/tenor/repository.ts`).
 */
export class GeneratedGifRepository {
  constructor(private readonly database: DatabasePool = pool) {}

  async store(input: StoreGeneratedGifInput): Promise<string> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');

      const gif = await this.insertGif(client, input);
      await this.insertProvenance(client, gif, input);

      await client.query('COMMIT');
      return gif;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertGif(client: TransactionClient, input: StoreGeneratedGifInput): Promise<string> {
    const title = `AI-generated ${input.categoryName} GIF`.slice(0, 255);
    const metadata = {
      provider: 'openai',
      model: input.model,
      generationPromptId: input.promptId,
      prompt: input.promptText,
      revisedPrompt: input.revisedPrompt ?? null,
    };
    const result = await client.query<{ id: string }>(
      `INSERT INTO gifs
         (source, title, description, category_id, url, storage_path,
          width, height, file_size_bytes, mime_type, metadata)
       VALUES ('ai_generated', $1, $2, $3, $4, $5, $6, $7, $8, 'image/gif', $9::jsonb)
       RETURNING id`,
      [
        title,
        input.promptText.slice(0, 1000),
        input.categoryId,
        input.url,
        input.storagePath,
        input.width,
        input.height,
        input.fileSizeBytes,
        JSON.stringify(metadata),
      ]
    );
    return result.rows[0].id;
  }

  private async insertProvenance(client: TransactionClient, gifId: string, input: StoreGeneratedGifInput): Promise<void> {
    await client.query(
      `INSERT INTO third_party_references (gif_id, provider, attribution, raw_metadata)
       VALUES ($1, 'openai', 'Generated with OpenAI', $2::jsonb)`,
      [
        gifId,
        JSON.stringify({
          model: input.model,
          generationPromptId: input.promptId,
          prompt: input.promptText,
          revisedPrompt: input.revisedPrompt ?? null,
        }),
      ]
    );
  }
}

/**
 * Shared types for the batch generation scheduler (`src/services/generation`, L42-424).
 * See docs/specs/ai-generation-prompts-spec.md (L42-423) for the business
 * rules (BR-1..BR-7) this module implements.
 */

export interface CategoryPromptStatus {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  /** Whether this category currently has at least one active prompt (BR-1). */
  hasActivePrompt: boolean;
}

export interface GenerationPrompt {
  id: string;
  categoryId: string;
  categorySlug: string;
  promptText: string;
}

export interface RecordSucceededAttempt {
  status: 'succeeded';
  promptId: string;
  categoryId: string;
  promptText: string;
  model: string;
  costUsd: number;
  gifId: string;
}

export interface RecordFailedAttempt {
  status: 'failed';
  /** May be absent if the failure happened before a prompt could be picked. */
  promptId?: string;
  categoryId?: string;
  promptText: string;
  model?: string;
  costUsd?: number;
  errorCode: string;
  errorMessage: string;
}

export type RecordAttempt = RecordSucceededAttempt | RecordFailedAttempt;

export interface StoreGeneratedGifInput {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  promptId: string;
  promptText: string;
  revisedPrompt?: string;
  model: string;
  gif: Buffer;
  url: string;
  storagePath: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

export interface GenerationBatchResult {
  /** Categories that had no active prompt and were skipped (BR-1). */
  skippedCategories: string[];
  attempted: number;
  succeeded: number;
  failed: number;
  /** Set when a run stopped early because the configured cost budget was hit. */
  stoppedOnCostBudget: boolean;
}

/**
 * Batch generation scheduler (L42-424): on a cron schedule (daily by
 * default; weekly is just a different `GENERATION_CRON_SCHEDULE`), picks a
 * prompt for every category that has one, generates an image via the
 * OpenAI client (`src/services/ai`, L42-421), converts it to a GIF
 * (`src/services/gif`, L42-422), uploads it to storage
 * (`src/services/storage`) and records the result (`gifs` +
 * `generation_attempts`).
 *
 * Business rules implemented here (see docs/specs/ai-generation-prompts-spec.md):
 *   - BR-1: a category with zero active prompts is skipped with a logged
 *     warning, not an error.
 *   - BR-2: the prompt for a category is chosen at random among its active
 *     prompts (`GenerationPromptRepository.pickRandomActivePrompt`), so
 *     repeated runs are not stuck reusing the same one.
 *   - BR-7 / success metric ("no silent drops"): every attempt - success or
 *     failure - is written to `generation_attempts`, attributed to the
 *     prompt that was used. A single category's failure is caught and
 *     logged; it does not abort the rest of the batch.
 *   - Gap G6 (cost/quota): `CostBudgetExceededError` from the AI client
 *     (`OPENAI_COST_BUDGET_USD`) stops the *entire remaining* run rather
 *     than being treated as a per-category failure, since it means further
 *     calls would also be rejected (and every OpenAI call already has its
 *     own request-rate limiter - see `src/services/ai/rateLimiter.ts`).
 */
import { randomUUID } from 'crypto';
import * as cron from 'node-cron';
import { env } from '../../config/env';
import { openaiImageClient, type OpenAIImageClient } from '../ai';
import { CostBudgetExceededError } from '../ai/errors';
import { gifConverter, imageInputFromGeneratedImage, type GifConverter } from '../gif';
import { gifStorage, type GifStorage } from '../storage';
import { GenerationAttemptsRepository } from './attemptsRepository';
import { GeneratedGifRepository } from './gifRepository';
import { GenerationPromptRepository } from './promptRepository';
import type { GenerationBatchResult } from './types';

/* eslint-disable no-console */

export interface GenerationBatchDeps {
  promptRepository: Pick<GenerationPromptRepository, 'listCategoryPromptStatus' | 'pickRandomActivePrompt'>;
  attemptsRepository: Pick<GenerationAttemptsRepository, 'record'>;
  gifRepository: Pick<GeneratedGifRepository, 'store'>;
  aiClient: Pick<OpenAIImageClient, 'generateImage'>;
  converter: Pick<GifConverter, 'convert'>;
  storage: Pick<GifStorage, 'save'>;
  /** 0 = no cap (every category with an active prompt). */
  maxCategoriesPerRun?: number;
  /** Injectable for tests; defaults to `randomUUID`. */
  generateFilename?: () => string;
}

function defaultDeps(): GenerationBatchDeps {
  return {
    promptRepository: new GenerationPromptRepository(),
    attemptsRepository: new GenerationAttemptsRepository(),
    gifRepository: new GeneratedGifRepository(),
    aiClient: openaiImageClient,
    converter: gifConverter,
    storage: gifStorage,
    maxCategoriesPerRun: env.generation.maxCategoriesPerRun,
  };
}

function classifyError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return { code: error.name || 'Error', message: error.message };
  }
  return { code: 'UnknownError', message: String(error) };
}

/** Runs one batch: at most one generation attempt per category that has an active prompt. */
export async function runGenerationBatch(deps: Partial<GenerationBatchDeps> = {}): Promise<GenerationBatchResult> {
  const { promptRepository, attemptsRepository, gifRepository, aiClient, converter, storage, maxCategoriesPerRun, generateFilename } = {
    ...defaultDeps(),
    ...deps,
  };

  const result: GenerationBatchResult = {
    skippedCategories: [],
    attempted: 0,
    succeeded: 0,
    failed: 0,
    stoppedOnCostBudget: false,
  };

  const categories = await promptRepository.listCategoryPromptStatus();

  for (const category of categories) {
    if (!category.hasActivePrompt) {
      // BR-1: skip, log a warning, keep going - never error out the whole run.
      console.warn(`[generation] Skipping category "${category.categorySlug}": no active prompt.`);
      result.skippedCategories.push(category.categorySlug);
      continue;
    }

    if (maxCategoriesPerRun && maxCategoriesPerRun > 0 && result.attempted >= maxCategoriesPerRun) {
      break;
    }

    const prompt = await promptRepository.pickRandomActivePrompt(category.categoryId);
    if (!prompt) {
      // Race: the category's last active prompt was deactivated between the
      // two queries above. Treat the same as BR-1 rather than erroring.
      console.warn(`[generation] Skipping category "${category.categorySlug}": no active prompt (race).`);
      result.skippedCategories.push(category.categorySlug);
      continue;
    }

    result.attempted += 1;

    try {
      const generation = await aiClient.generateImage({ prompt: prompt.promptText });
      const image = generation.images[0];
      if (!image) {
        throw new Error('Image generation API returned no images.');
      }

      const converted = await converter.convert([imageInputFromGeneratedImage(image)]);
      const filename = `${(generateFilename ?? randomUUID)()}.gif`;
      const stored = await storage.save(converted.gif, filename, 'image/gif');

      const gifId = await gifRepository.store({
        categoryId: category.categoryId,
        categorySlug: category.categorySlug,
        categoryName: category.categoryName,
        promptId: prompt.id,
        promptText: prompt.promptText,
        revisedPrompt: image.revisedPrompt,
        model: generation.model,
        gif: converted.gif,
        url: stored.url,
        storagePath: stored.storagePath,
        width: converted.width,
        height: converted.height,
        fileSizeBytes: stored.sizeBytes,
      });

      await attemptsRepository.record({
        status: 'succeeded',
        promptId: prompt.id,
        categoryId: category.categoryId,
        promptText: prompt.promptText,
        model: generation.model,
        costUsd: generation.costUsd,
        gifId,
      });

      result.succeeded += 1;
    } catch (error) {
      result.failed += 1;
      const { code, message } = classifyError(error);
      console.error(`[generation] Attempt failed for category "${category.categorySlug}": ${message}`);

      await attemptsRepository.record({
        status: 'failed',
        promptId: prompt.id,
        categoryId: category.categoryId,
        promptText: prompt.promptText,
        errorCode: code,
        errorMessage: message,
      });

      if (error instanceof CostBudgetExceededError) {
        // Every subsequent call would also be rejected - stop the whole run
        // rather than recording N more identical budget-exceeded failures.
        result.stoppedOnCostBudget = true;
        console.error('[generation] Cost budget exceeded - stopping the rest of this batch run.');
        break;
      }
    }
  }

  console.log(
    `[generation] Batch run complete: ${result.succeeded} succeeded, ${result.failed} failed, ` +
      `${result.skippedCategories.length} skipped (attempted ${result.attempted}).`
  );

  return result;
}

let scheduledTask: cron.ScheduledTask | null = null;

/**
 * Starts the cron-scheduled batch job (no-op if `GENERATION_SCHEDULER_ENABLED`
 * is unset/false, or if already started). Call once at process startup
 * (see `src/index.ts`).
 */
export function startGenerationScheduler(): void {
  if (!env.generation.enabled) {
    console.log('[generation] Scheduler disabled (GENERATION_SCHEDULER_ENABLED is not set). Skipping.');
    return;
  }
  if (scheduledTask) {
    return;
  }
  if (!cron.validate(env.generation.cronSchedule)) {
    throw new Error(`Invalid GENERATION_CRON_SCHEDULE: "${env.generation.cronSchedule}"`);
  }

  scheduledTask = cron.schedule(
    env.generation.cronSchedule,
    () => {
      void runGenerationBatch().catch((error) => {
        console.error('[generation] Unhandled error running scheduled batch', error);
      });
    },
    {
      timezone: env.generation.timezone,
      // A run can take minutes (image generation + ffmpeg per category); if
      // one is still running when the next tick fires, skip that tick
      // rather than running two batches concurrently against the same DB.
      noOverlap: true,
    }
  );

  console.log(
    `[generation] Scheduler started: "${env.generation.cronSchedule}" (${env.generation.timezone}).`
  );

  if (env.generation.runOnStart) {
    void runGenerationBatch().catch((error) => {
      console.error('[generation] Unhandled error running startup batch', error);
    });
  }
}

/** Stops the scheduled task, if running. Used by graceful shutdown and tests. */
export function stopGenerationScheduler(): void {
  if (scheduledTask) {
    void scheduledTask.stop();
    scheduledTask = null;
  }
}

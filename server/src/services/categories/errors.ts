import { HttpError } from '../../middleware/errorHandler';

/**
 * Thrown by `CategoryRepository.deleteCategory` when the category still has `generation_prompts`
 * rows pointing at it (`generation_prompts.category_id` is `ON DELETE RESTRICT` -- see
 * ADR-0001 / L42-444). Maps to `409 Conflict` with a stable `code` and the blocking row count so
 * API clients can render/automate the documented retirement procedure instead of retrying a
 * delete that will just fail again.
 */
export class CategoryHasGenerationPromptsError extends HttpError {
  static readonly CODE = 'category_has_generation_prompts';

  readonly blockingPromptCount: number;

  constructor(blockingPromptCount: number) {
    super(
      409,
      `Category cannot be deleted: ${blockingPromptCount} generation_prompts row(s) still reference it. ` +
        'Deactivate (is_active = false) and purge those prompts first - see docs/database-schema.md#category-retirement.',
      { code: CategoryHasGenerationPromptsError.CODE, details: { blockingPromptCount } }
    );
    this.blockingPromptCount = blockingPromptCount;
  }
}

interface PostgresError extends Error {
  /**
   * SQLSTATE. Set by `pg` and by PGlite alike. For an FK violation this is either `23503`
   * (`foreign_key_violation`, the default `NO ACTION` case) or `23001` (`restrict_violation`,
   * used specifically for an explicit `ON DELETE/UPDATE RESTRICT` FK, which is what
   * `generation_prompts.category_id` is - see `ri_ReportViolation` in Postgres's
   * `ri_triggers.c`). Both are handled the same way here: either one means the row can't be
   * deleted while the reference exists.
   */
  code?: string;
  /** The violated constraint's name, when the driver reports one. */
  constraint?: string;
}

const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';

/**
 * True when `err` is a Postgres foreign-key-violation (SQLSTATE `23503`) or the RESTRICT-specific
 * variant (SQLSTATE `23001`), optionally narrowed to a specific constraint name. Used as a
 * race-condition safety net around `deleteCategory`'s up-front count check (a prompt could
 * theoretically be inserted between the check and the `DELETE`) - the count check is what
 * produces the friendly, accurate error in the common case.
 */
export function isForeignKeyViolation(err: unknown, constraintName?: string): err is PostgresError {
  if (!(err instanceof Error)) return false;
  const pgErr = err as PostgresError;
  if (pgErr.code !== FOREIGN_KEY_VIOLATION && pgErr.code !== RESTRICT_VIOLATION) return false;
  return constraintName === undefined || pgErr.constraint === constraintName;
}

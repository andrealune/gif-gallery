import { HttpError } from '../middleware/errorHandler';

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginationOptions {
  /** Used when the caller doesn't pass `limit`. Defaults to 20. */
  defaultLimit?: number;
  /** Largest `limit` a caller may request. Defaults to 100. */
  maxLimit?: number;
}

/**
 * Parses/validates `limit`/`offset` query parameters shared by every paginated list endpoint
 * (categories, gifs-by-category, ...). Both must be non-negative integers; `limit` is additionally
 * clamped to `[1, maxLimit]`. Throws a 400 `HttpError` (handled by the app's error middleware) for
 * anything else - non-numeric, negative, fractional, or over the max - rather than silently
 * clamping, so callers get an explicit signal instead of a confusingly different page size.
 */
export function parsePagination(
  query: Record<string, unknown>,
  options: PaginationOptions = {}
): PaginationParams {
  const defaultLimit = options.defaultLimit ?? 20;
  const maxLimit = options.maxLimit ?? 100;

  const limit = parseIntParam(query.limit, 'limit', defaultLimit, 1, maxLimit);
  const offset = parseIntParam(query.offset, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);

  return { limit, offset };
}

function parseIntParam(raw: unknown, name: string, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;

  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new HttpError(400, `Query parameter '${name}' must be an integer between ${min} and ${max}`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `Query parameter '${name}' must be an integer between ${min} and ${max}`);
  }

  return parsed;
}

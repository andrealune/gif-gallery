import type { NextFunction, Request, Response } from 'express';

export interface HttpErrorOptions {
  /** Stable, machine-readable code for API clients to branch on (e.g. `category_has_generation_prompts`). */
  code?: string;
  /** Structured extra detail for the client, e.g. `{ blockingPromptCount: 3 }` (L42-444). */
  details?: Record<string, unknown>;
}

export class HttpError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.status = status;
    this.code = options.code;
    this.details = options.details;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
}

/**
 * Generic message returned to clients for any 5xx (unexpected) failure.
 *
 * Errors in this bucket are almost always internal-detail leaks waiting to happen: a raw
 * `ECONNREFUSED ...` from a dead DB/Elasticsearch connection, a driver's stack-trace-flavoured
 * message, etc. (see L42-458). Those are still logged in full server-side below; only the
 * intentional, caller-authored `HttpError`s thrown for 4xx cases (bad input, not-found lookups -
 * see `routes/*.ts` and `utils/pagination.ts`) get their message echoed back, since those are
 * written to be safe and useful to the client.
 */
const GENERIC_SERVER_ERROR_MESSAGE = 'Internal server error';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = err instanceof HttpError ? err.status : 500;

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  // Only messages from our own `HttpError` (always thrown deliberately, with a message written
  // to be shown to a client - a 4xx by construction, since nothing in this codebase throws an
  // `HttpError` with a 5xx status) are safe to return verbatim. Anything else - a driver error, a
  // rejected promise, a plain `Error` thrown from deep in a dependency, ... - keeps its detail out
  // of the response and only ever reaches the server log above.
  const message = err instanceof HttpError ? err.message : GENERIC_SERVER_ERROR_MESSAGE;

  // `code`/`details` only ever come from our own `HttpError` subclasses (e.g.
  // `CategoryHasGenerationPromptsError`, L42-444) - never set for a generic 5xx, so omitted below
  // and nothing extra leaks for those. Existing callers that only pass `(status, message)` are
  // unaffected: `code`/`details` stay `undefined` and are left out of the response, same as today.
  const code = err instanceof HttpError ? err.code : undefined;
  const details = err instanceof HttpError ? err.details : undefined;

  res.status(status).json({
    error: message,
    ...(code ? { code } : {}),
    ...(details ? { details } : {}),
  });
}

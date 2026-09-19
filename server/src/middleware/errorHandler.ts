import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

  res.status(status).json({ error: message });
}

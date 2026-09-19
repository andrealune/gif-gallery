/**
 * Error hierarchy for the OpenAI image generation client.
 *
 * Callers (e.g. the future `/api/generate` route) can `instanceof`-check
 * these to decide how to respond to the client - e.g. map
 * `OpenAIRateLimitError` to a 429, `OpenAIAuthError`/`OpenAIConfigError` to a
 * 500 (it's a server misconfiguration, not the caller's fault), etc.
 */
export class OpenAIImageClientError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'OpenAIImageClientError';
    this.cause = cause;
  }
}

/** The client is missing configuration it needs (API key, invalid input, ...). */
export class OpenAIConfigError extends OpenAIImageClientError {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAIConfigError';
  }
}

/** The API rejected our credentials (HTTP 401/403). Never retried. */
export class OpenAIAuthError extends OpenAIImageClientError {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OpenAIAuthError';
    this.status = status;
  }
}

/** The API told us to slow down (HTTP 429). Retried with backoff. */
export class OpenAIRateLimitError extends OpenAIImageClientError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'OpenAIRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Any other 4xx (bad prompt, content policy violation, invalid params, ...). Never retried. */
export class OpenAIRequestError extends OpenAIImageClientError {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OpenAIRequestError';
    this.status = status;
  }
}

/** HTTP 5xx from the API. Retried with backoff. */
export class OpenAIServerError extends OpenAIImageClientError {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OpenAIServerError';
    this.status = status;
  }
}

/** The request did not complete within the configured timeout. Retried with backoff. */
export class OpenAITimeoutError extends OpenAIImageClientError {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAITimeoutError';
  }
}

/** The configured cost budget would be exceeded by this request; it was not sent. */
export class CostBudgetExceededError extends OpenAIImageClientError {
  readonly totalCostUsd: number;
  readonly budgetUsd: number;

  constructor(totalCostUsd: number, budgetUsd: number) {
    super(
      `OpenAI image generation cost budget exceeded: ` +
        `$${totalCostUsd.toFixed(4)} spent (+ this request) vs a $${budgetUsd.toFixed(4)} budget`
    );
    this.name = 'CostBudgetExceededError';
    this.totalCostUsd = totalCostUsd;
    this.budgetUsd = budgetUsd;
  }
}

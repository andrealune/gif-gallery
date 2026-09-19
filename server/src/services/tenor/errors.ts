export class TenorError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TenorError';
  }
}

export class TenorConfigError extends TenorError {
  constructor(message: string) {
    super(message);
    this.name = 'TenorConfigError';
  }
}

export class TenorApiError extends TenorError {
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(status: number, message: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = 'TenorApiError';
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export class TenorResponseError extends TenorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TenorResponseError';
  }
}

/**
 * Error hierarchy for the Elasticsearch search integration (client, index
 * management, indexing pipeline). Mirrors `services/ai/errors.ts` /
 * `services/tenor` so callers can `instanceof`-check a specific failure mode.
 */
export class ElasticsearchClientError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ElasticsearchClientError';
    this.cause = cause;
  }
}

/** Missing/invalid configuration (no node URL, contradictory auth, ...). Never retried. */
export class ElasticsearchConfigError extends ElasticsearchClientError {
  constructor(message: string) {
    super(message);
    this.name = 'ElasticsearchConfigError';
  }
}

/** The indexing pipeline could not finish cleanly (partial failures, alias swap failed, ...). */
export class IndexingPipelineError extends ElasticsearchClientError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'IndexingPipelineError';
  }
}

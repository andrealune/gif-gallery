import { env } from '../../config/env';
import { TenorClient } from './client';
import { TenorImporter } from './importer';
import { TenorGifRepository } from './repository';

export * from './client';
export * from './errors';
export * from './importer';
export * from './repository';
export * from './types';

/** Builds the production importer without exposing the API key to callers or logs. */
export function createTenorImporter(): TenorImporter {
  const client = new TenorClient({
    apiKey: env.tenor.apiKey,
    clientKey: env.tenor.clientKey,
    timeoutMs: env.tenor.requestTimeoutMs,
    maxRetries: env.tenor.maxRetries,
    retryBaseDelayMs: env.tenor.retryBaseDelayMs,
    requestsPerSecond: env.tenor.requestsPerSecond,
  });
  return new TenorImporter(client, new TenorGifRepository());
}

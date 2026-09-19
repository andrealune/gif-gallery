/**
 * Elasticsearch client factory + a process-wide shared instance, mirroring
 * `db/pool.ts`'s shared Postgres pool.
 *
 * Supports both a local/self-hosted cluster (no auth, plain HTTP -- see
 * `docker-compose.yml`) and a managed/cloud cluster (TLS + API key or
 * basic auth). See `.env.example` / docs/elasticsearch.md for the full list
 * of `ELASTICSEARCH_*` variables.
 */
import { Client, type ClientOptions } from '@elastic/elasticsearch';
import { env } from '../config/env';
import { ElasticsearchConfigError } from './errors';

let sharedClient: Client | null = null;

function buildClientOptions(): ClientOptions {
  const { node, username, password, apiKey, tlsRejectUnauthorized, requestTimeoutMs, maxRetries } =
    env.elasticsearch;

  if (!node) {
    throw new ElasticsearchConfigError(
      'ELASTICSEARCH_NODE is not set. Point it at a local cluster ' +
        '(e.g. http://localhost:9200, see docker-compose.yml) or a managed/cloud endpoint.'
    );
  }
  if (username && !password) {
    throw new ElasticsearchConfigError('ELASTICSEARCH_USERNAME is set but ELASTICSEARCH_PASSWORD is missing');
  }
  if (env.isProduction && !apiKey && !(username && password) && !node.includes('localhost')) {
    // Not a hard failure -- some deployments legitimately run an
    // unauthenticated cluster inside a private network -- but production
    // pointed at a non-local host with no credentials configured is almost
    // always a misconfiguration, so it is surfaced loudly rather than
    // failing silently on every query.
    // eslint-disable-next-line no-console
    console.warn(
      'Warning: ELASTICSEARCH_NODE looks like a remote cluster but no ELASTICSEARCH_API_KEY or ' +
        'ELASTICSEARCH_USERNAME/PASSWORD is configured. Requests will be sent unauthenticated.'
    );
  }

  const options: ClientOptions = {
    node,
    requestTimeout: requestTimeoutMs,
    maxRetries,
  };

  if (node.startsWith('https')) {
    options.tls = { rejectUnauthorized: tlsRejectUnauthorized };
  }

  if (apiKey) {
    options.auth = { apiKey };
  } else if (username && password) {
    options.auth = { username, password };
  }

  return options;
}

/** Builds a brand-new client. Prefer `getElasticsearchClient()` unless the caller needs an isolated instance (tests). */
export function createElasticsearchClient(): Client {
  return new Client(buildClientOptions());
}

/** A single shared client for the whole process, created lazily on first use. */
export function getElasticsearchClient(): Client {
  if (!sharedClient) {
    sharedClient = createElasticsearchClient();
  }
  return sharedClient;
}

/** Verifies connectivity to the cluster. Used at startup and by the health check, same pattern as `checkDatabaseConnection`. */
export async function checkElasticsearchConnection(client: Client = getElasticsearchClient()): Promise<boolean> {
  try {
    await client.ping();
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Elasticsearch connection check failed', err);
    return false;
  }
}

export async function closeElasticsearchClient(): Promise<void> {
  if (sharedClient) {
    await sharedClient.close();
    sharedClient = null;
  }
}

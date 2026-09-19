import { createApp } from './app';
import { env } from './config/env';
import { checkDatabaseConnection, closePool } from './db/pool';
import {
  checkElasticsearchConnection,
  closeElasticsearchClient,
  createGifSearchSyncJob,
  getElasticsearchClient,
  type GifSearchSyncJob,
} from './search';

/**
 * Starts the incremental Elasticsearch sync job (`search/syncJob.ts`,
 * L42-419) inline in this process, unless disabled via
 * `ELASTICSEARCH_SYNC_ENABLED=false` (e.g. when it is run instead as its
 * own worker via `npm run search:sync`). Best-effort: if Elasticsearch is
 * not reachable at startup the API still starts (search-related routes
 * degrade, but the rest of the app is unaffected) and this simply skips
 * starting the job -- restart once the cluster is back, or run
 * `npm run search:sync` separately in the meantime.
 */
async function startSearchSyncJob(): Promise<GifSearchSyncJob | null> {
  if (!env.elasticsearch.syncEnabled) {
    return null;
  }

  const client = getElasticsearchClient();
  const isConnected = await checkElasticsearchConnection(client);
  if (!isConnected) {
    // eslint-disable-next-line no-console
    console.warn(
      'Warning: could not reach Elasticsearch on startup. The gifs search index will not be kept ' +
        'in sync until this process is restarted with a reachable cluster (or run `npm run search:sync` ' +
        'standalone once it is back).'
    );
    return null;
  }

  const job = createGifSearchSyncJob({
    client,
    onError: (error) => {
      // eslint-disable-next-line no-console
      console.error('Elasticsearch sync batch failed, will retry on the next interval', error);
    },
  });
  job.start();
  // eslint-disable-next-line no-console
  console.log('Started the gifs Elasticsearch sync job.');
  return job;
}

async function main(): Promise<void> {
  const app = createApp();

  const isDbConnected = await checkDatabaseConnection();
  if (!isDbConnected) {
    // eslint-disable-next-line no-console
    console.warn(
      'Warning: could not connect to the database on startup. ' +
        'The server will still start, but DB-backed routes will fail until the connection is available.'
    );
  }

  const syncJob = await startSearchSyncJob();

  const server = app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`gif-gallery server listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      await syncJob?.stop();
      await closeElasticsearchClient();
      await closePool();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during startup', err);
  process.exit(1);
});

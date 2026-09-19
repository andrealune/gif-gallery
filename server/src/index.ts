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
 *
 * Deliberately not awaited by `main()` before it calls `app.listen()` (see
 * L42-458): the Elasticsearch reachability check below can be slow (up to
 * the request timeout) when the cluster is unreachable, and there is no
 * reason the HTTP listener - and every non-search route - should wait on
 * it. `main()` instead fires this in the background and only wires up the
 * resulting job (for graceful shutdown) once/if it resolves.
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
import { startGenerationScheduler, stopGenerationScheduler } from './services/generation';

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

  // Batch generation scheduler (L42-424) - no-op unless
  // GENERATION_SCHEDULER_ENABLED is set; see src/config/env.ts.
  startGenerationScheduler();

  const server = app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`gif-gallery server listening on port ${env.port} (${env.nodeEnv})`);
  });

  // Started in the background, after the listener is already up (L42-458) - see the
  // `startSearchSyncJob` doc comment above for why this isn't awaited here. `syncJob` is filled
  // in once/if it resolves, purely so `shutdown()` below can stop it cleanly; nothing else in this
  // module depends on it being ready yet.
  let syncJob: GifSearchSyncJob | null = null;
  let syncJobStarting = true;
  const syncJobReady = startSearchSyncJob()
    .then((job) => {
      syncJob = job;
      return job;
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Failed to start the gifs Elasticsearch sync job', error);
      return null;
    })
    .finally(() => {
      syncJobStarting = false;
    });

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, shutting down gracefully...`);
    stopGenerationScheduler();
    // Make sure the background bootstrap above has settled (and, if it started a job, that
    // `syncJob` has been filled in) before deciding whether there's anything to stop.
    if (syncJobStarting) {
      await syncJobReady;
    }
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

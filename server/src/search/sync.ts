/**
 * Standalone worker entrypoint for the sync job (`syncJob.ts`, L42-419):
 * continuously syncs individual gif create/update/(soft-)delete calls into
 * the `gifs` Elasticsearch alias. Runs forever until interrupted.
 *
 * By default the API process (`src/index.ts`) already runs this job inline
 * (see `ELASTICSEARCH_SYNC_ENABLED`); this script is for deployments that
 * would rather run it as its own process/container instead (set
 * `ELASTICSEARCH_SYNC_ENABLED=false` on the API process to avoid running it
 * twice -- though running it in both is harmless, just redundant work, each
 * keeps its own in-memory cursor and every operation is idempotent).
 *
 * Usage (from server/):
 *   npm run search:sync
 */
import { checkElasticsearchConnection, closeElasticsearchClient, getElasticsearchClient } from './client';
import { GIFS_ALIAS } from './pipeline';
import { createGifSearchSyncJob } from './syncJob';

async function main(): Promise<void> {
  const client = getElasticsearchClient();

  const connected = await checkElasticsearchConnection(client);
  if (!connected) {
    throw new Error(
      `Could not reach Elasticsearch. Check ELASTICSEARCH_NODE and that the cluster is running ` +
        `(see docker-compose.yml for local dev).`
    );
  }

  // eslint-disable-next-line no-console
  console.log(`Starting the "${GIFS_ALIAS}" sync job (Ctrl+C to stop)...`);

  const job = createGifSearchSyncJob({
    client,
    onBatch: (result) => {
      // eslint-disable-next-line no-console
      console.log(
        `Synced ${result.processed} change(s): ${result.indexed} indexed, ${result.deleted} deleted ` +
          `(cursor: ${result.cursor?.updatedAt ?? '(none)'})`
      );
    },
    onError: (error) => {
      // eslint-disable-next-line no-console
      console.error('Sync batch failed, will retry on the next interval:', error);
    },
  });
  job.start();

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, stopping...`);
    await job.stop();
    await closeElasticsearchClient();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error starting the sync job:', err);
  process.exitCode = 1;
});

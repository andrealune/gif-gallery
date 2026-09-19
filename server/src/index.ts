import { createApp } from './app';
import { env } from './config/env';
import { checkDatabaseConnection, closePool } from './db/pool';

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

  const server = app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`gif-gallery server listening on port ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
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

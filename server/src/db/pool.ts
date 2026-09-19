import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '../config/env';

function buildPoolConfig(): PoolConfig {
  const base: PoolConfig = {
    max: env.db.poolMax,
    idleTimeoutMillis: env.db.idleTimeoutMillis,
    connectionTimeoutMillis: env.db.connectionTimeoutMillis,
    ssl: env.db.ssl ? { rejectUnauthorized: false } : undefined,
  };

  if (env.db.connectionString) {
    return { ...base, connectionString: env.db.connectionString };
  }

  return {
    ...base,
    host: env.db.host,
    port: env.db.port,
    database: env.db.database,
    user: env.db.user,
    password: env.db.password,
  };
}

// A single shared connection pool for the whole process. Routes/services
// should import `pool` (or use `query`) rather than creating their own.
export const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => {
  // Errors on idle clients must be handled or the process will crash.
  // eslint-disable-next-line no-console
  console.error('Unexpected error on idle database client', err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

/** Verifies connectivity to the database. Used at startup and by the health check. */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Database connection check failed', err);
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

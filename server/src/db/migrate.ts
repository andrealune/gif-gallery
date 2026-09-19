/**
 * Minimal, dependency-free SQL migration runner.
 *
 * Migrations live in `server/migrations` as paired files:
 *   NNNN_description.up.sql
 *   NNNN_description.down.sql
 *
 * Applied migrations are tracked in a `schema_migrations` table (created on
 * first run). Each migration runs inside its own transaction. A Postgres
 * advisory lock prevents two runners (e.g. two deploys) from migrating the
 * same database at once.
 *
 * Usage (from server/):
 *   npm run migrate:status
 *   npm run migrate:up
 *   npm run migrate:down            # rolls back the single most recent migration
 *   npm run migrate:down -- --step 3
 *
 * Locking/rollback/data-impact notes for each migration live as a comment
 * header in its own .up.sql/.down.sql file -- read those before running
 * `migrate:down` against a database that already has real data in it.
 */
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { Client } from 'pg';
import { env } from '../config/env';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');
// Arbitrary, fixed advisory lock key for this project's migration runner.
const ADVISORY_LOCK_KEY = 42414;

interface Migration {
  name: string;
  upPath: string;
  downPath: string;
}

function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.up.sql'));
  const migrations = files
    .map((upFile) => {
      const name = upFile.replace(/\.up\.sql$/, '');
      const downFile = `${name}.down.sql`;
      return {
        name,
        upPath: path.join(MIGRATIONS_DIR, upFile),
        downPath: path.join(MIGRATIONS_DIR, downFile),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const migration of migrations) {
    try {
      readFileSync(migration.downPath, 'utf8');
    } catch {
      throw new Error(`Missing down migration for ${migration.name}: expected ${migration.downPath}`);
    }
  }

  return migrations;
}

function buildClient(): Client {
  if (env.db.connectionString) {
    return new Client({
      connectionString: env.db.connectionString,
      ssl: env.db.ssl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return new Client({
    host: env.db.host,
    port: env.db.port,
    database: env.db.database,
    user: env.db.user,
    password: env.db.password,
    ssl: env.db.ssl ? { rejectUnauthorized: false } : undefined,
  });
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedNames(client: Client): Promise<Set<string>> {
  const result = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(result.rows.map((r) => r.name));
}

async function withAdvisoryLock<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}

async function runUp(client: Client): Promise<void> {
  const migrations = loadMigrations();
  const applied = await getAppliedNames(client);
  const pending = migrations.filter((m) => !applied.has(m.name));

  if (pending.length === 0) {
    console.log('Nothing to migrate: database is up to date.');
    return;
  }

  for (const migration of pending) {
    const sql = readFileSync(migration.upPath, 'utf8');
    console.log(`Applying ${migration.name}...`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migration.name]);
      await client.query('COMMIT');
      console.log(`  ok: ${migration.name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  failed: ${migration.name}`);
      throw err;
    }
  }
}

async function runDown(client: Client, step: number): Promise<void> {
  const migrations = loadMigrations();
  const applied = await getAppliedNames(client);
  const toRollback = migrations
    .filter((m) => applied.has(m.name))
    .sort((a, b) => b.name.localeCompare(a.name)) // reverse order
    .slice(0, step);

  if (toRollback.length === 0) {
    console.log('Nothing to roll back.');
    return;
  }

  for (const migration of toRollback) {
    const sql = readFileSync(migration.downPath, 'utf8');
    console.log(`Rolling back ${migration.name}...`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [migration.name]);
      await client.query('COMMIT');
      console.log(`  ok: ${migration.name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  failed: ${migration.name}`);
      throw err;
    }
  }
}

async function runStatus(client: Client): Promise<void> {
  const migrations = loadMigrations();
  const applied = await getAppliedNames(client);
  for (const migration of migrations) {
    const marker = applied.has(migration.name) ? '[applied]' : '[pending]';
    console.log(`${marker} ${migration.name}`);
  }
}

function parseStep(args: string[]): number {
  const idx = args.indexOf('--step');
  if (idx === -1) return 1;
  const value = parseInt(args[idx + 1], 10);
  return Number.isNaN(value) || value < 1 ? 1 : value;
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const client = buildClient();
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    await withAdvisoryLock(client, async () => {
      switch (command) {
        case 'up':
          await runUp(client);
          break;
        case 'down':
          await runDown(client, parseStep(rest));
          break;
        case 'status':
          await runStatus(client);
          break;
        default:
          console.error('Usage: migrate.ts <up|down|status> [--step N]');
          process.exitCode = 1;
      }
    });
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

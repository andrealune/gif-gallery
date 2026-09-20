/**
 * `GET /api/search` end-to-end through the Postgres backend (L42-463): builds the real Express router
 * (`createSearchRouter`) around a `PostgresGifSearchQueryService` backed by an embedded, in-memory
 * Postgres (PGlite), the same technique `test/search/postgresSearchService.test.ts` uses for the service
 * itself. `test/search/routes.test.ts` already covers the route's request parsing/error-handling
 * generically (against a fake `GifSearchQueryServiceLike`, which the Elasticsearch backend also
 * implements) - this file is the "both backends" route coverage the issue calls for: proof that the
 * Postgres backend really does produce the same `{ data, pagination }` envelope end to end.
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler';
import { createSearchRouter } from '../../src/routes/search';
import { PostgresGifSearchQueryService } from '../../src/search/postgresSearchService';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

function loadMigrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.replace(/\.up\.sql$/, ''))
    .sort((a, b) => a.localeCompare(b));
}

function readSql(name: string, direction: 'up' | 'down'): string {
  return readFileSync(path.join(MIGRATIONS_DIR, `${name}.${direction}.sql`), 'utf8');
}

function buildApp(db: PGlite): Express {
  const app = express();
  app.use('/api/search', createSearchRouter(new PostgresGifSearchQueryService(db as never)));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('GET /api/search (Postgres backend)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    for (const name of loadMigrationNames()) {
      await db.exec(readSql(name, 'up'));
    }
    await db.query(
      `INSERT INTO gifs (source, title, description, url) VALUES ('upload', 'Dancing cat', 'A cat dancing to music', 'https://example.com/cat.gif')`
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns the same { data, pagination } envelope the Elasticsearch backend uses', async () => {
    const res = await request(buildApp(db)).get('/api/search?q=cat');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: [expect.objectContaining({ title: 'Dancing cat', status: 'active' })],
      pagination: { limit: 24, offset: 0, total: 1 },
    });
  });

  it('still 400s on a missing q before ever touching the database', async () => {
    const res = await request(buildApp(db)).get('/api/search');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("'q'");
  });

  it('returns an empty page for a query with no matches', async () => {
    const res = await request(buildApp(db)).get('/api/search?q=nonexistentxyz');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], pagination: { limit: 24, offset: 0, total: 0 } });
  });
});

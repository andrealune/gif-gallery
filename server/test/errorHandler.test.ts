import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler, HttpError, notFoundHandler } from '../src/middleware/errorHandler';

function buildApp(handler: (req: express.Request, res: express.Response) => void): Express {
  const app = express();
  app.get('/boom', handler);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('returns the HttpError message verbatim for a 4xx (intentional, caller-authored) error', async () => {
    const app = buildApp(() => {
      throw new HttpError(400, "Query parameter 'q' is required");
    });

    const res = await request(app).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Query parameter 'q' is required" });
  });

  it('hides the underlying message for an unexpected error and returns a generic 500 body', async () => {
    const app = buildApp(() => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:1');
    });

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('hides the underlying message for a non-Error thrown value too', async () => {
    const app = buildApp(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'some internal detail';
    });

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  it('still returns 404 for unmatched routes via notFoundHandler', async () => {
    const app = buildApp(() => undefined);

    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Not found');
  });
});

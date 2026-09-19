import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((o) => o.trim()),
    })
  );
  app.use(express.json());
  if (!env.isTest) {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  // Local development only: serves files written by the "local" storage
  // driver so GIF URLs resolve without any external storage. Production
  // uses the S3 + CloudFront setup instead (STORAGE_PROVIDER=s3), which
  // serves objects directly from the CDN, not through this app.
  if (env.storage.provider === 'local') {
    app.use('/storage', express.static(path.resolve(process.cwd(), env.storage.localDir)));
  }

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

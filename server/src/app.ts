import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';
import { robotsRouter } from './routes/robots';
import { sitemapRouter } from './routes/sitemap';

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

  // Mounted at the root (not under /api): crawlers and search engines
  // expect /robots.txt and /sitemap.xml at the site origin (L42-433).
  app.use(robotsRouter);
  app.use(sitemapRouter);

  // Serves whatever the local storage adapter (src/services/storage,
  // consumed by the batch generation scheduler, L42-424) has written to
  // STORAGE_LOCAL_DIR - e.g. an AI-generated GIF's `url`. This only applies
  // to the 'local' storage provider; an S3 (or other) provider from
  // L42-425 would serve its own URLs directly and not need this route.
  if (env.storage.provider === 'local') {
    app.use('/storage', express.static(env.storage.localDir, { index: false, dotfiles: 'ignore' }));
  }

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

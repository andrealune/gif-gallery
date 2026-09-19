import { Router } from 'express';
import { healthRouter } from './health';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);

// Feature routers (gifs, categories, search, generate, sitemap, ...) are
// added by later tasks and mounted here, e.g.:
// apiRouter.use('/gifs', gifsRouter);
// apiRouter.use('/search', searchRouter);

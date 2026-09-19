import { Router } from 'express';
import { createCategoriesRouter } from './categories';
import { healthRouter } from './health';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/categories', createCategoriesRouter());

// Feature routers (gifs, search, generate, sitemap, ...) are added by later tasks and mounted
// here, e.g.:
// apiRouter.use('/gifs', gifsRouter);
// apiRouter.use('/search', searchRouter);

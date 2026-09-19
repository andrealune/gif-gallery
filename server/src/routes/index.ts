import { Router } from 'express';
import { createCategoriesRouter } from './categories';
import { createGifsRouter } from './gifs';
import { healthRouter } from './health';
import { createSearchRouter } from './search';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/categories', createCategoriesRouter());
apiRouter.use('/search', createSearchRouter());

// Feature routers (gifs, generate, ...) are added by later tasks and mounted here, e.g.:
// apiRouter.use('/gifs', gifsRouter);
apiRouter.use('/gifs', createGifsRouter());

// Feature routers (search, generate, ...) are added by later tasks and mounted here, e.g.:
// apiRouter.use('/search', searchRouter);

import { Router } from 'express';
import { HttpError } from '../middleware/errorHandler';
import { GifRepository } from '../services/gifs';
import type { GifRepositoryLike } from '../services/gifs';

/**
 * `GET /api/gifs/:idOrSlug` (L42-448) - single gif lookup by UUID or slug, same id-or-slug
 * convention as `GET /api/categories/:idOrSlug` (see `./categories.ts`). Backs the `/gif/[slug]`
 * page's dynamic Open Graph/Twitter Card metadata (L42-431 on the frontend); `repository` defaults
 * to a real `GifRepository` (backed by the shared pool) but can be swapped for a fake in tests -
 * see `test/gifs/routes.test.ts`.
 */
export function createGifsRouter(repository: GifRepositoryLike = new GifRepository()): Router {
  const router = Router();

  // GET /api/gifs/:idOrSlug
  // A single, publicly-visible (status = 'active') gif. Accepts either the gif's UUID or its slug.
  router.get('/:idOrSlug', async (req, res, next) => {
    try {
      const gif = await repository.findGif(req.params.idOrSlug);
      if (!gif) {
        throw new HttpError(404, `Gif not found: ${req.params.idOrSlug}`);
      }

      res.json({ data: gif });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

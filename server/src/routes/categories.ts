import { Router } from 'express';
import { HttpError } from '../middleware/errorHandler';
import { CategoryRepository } from '../services/categories';
import type { CategoryRepositoryLike } from '../services/categories';
import { parsePagination } from '../utils/pagination';

/**
 * `GET /api/categories`, `GET /api/categories/:idOrSlug`, `GET /api/categories/:idOrSlug/gifs`
 * (L42-417) and `DELETE /api/categories/:idOrSlug` (L42-444). `repository` defaults to a real
 * `CategoryRepository` (backed by the shared pool) but can be swapped for a fake in tests - see
 * `test/categories/routes.test.ts`.
 */
export function createCategoriesRouter(repository: CategoryRepositoryLike = new CategoryRepository()): Router {
  const router = Router();

  // GET /api/categories?limit=&offset=
  // Lists every category with its gif count. Categories are a small, curated set (currently the 8
  // seeded in migration 0008) so a generous default page size is fine; limit/offset still apply so
  // the response shape stays consistent with the other list endpoint below.
  router.get('/', async (req, res, next) => {
    try {
      const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
      const page = await repository.listCategories({ limit, offset });

      res.json({
        data: page.items,
        pagination: { limit: page.limit, offset: page.offset, total: page.total },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/categories/:idOrSlug
  // Single category plus its gif count. Accepts either the category's UUID or its slug.
  router.get('/:idOrSlug', async (req, res, next) => {
    try {
      const category = await repository.findCategory(req.params.idOrSlug);
      if (!category) {
        throw new HttpError(404, `Category not found: ${req.params.idOrSlug}`);
      }

      res.json({ data: category });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/categories/:idOrSlug/gifs?limit=&offset=
  // Paginated gifs belonging to the category (active only, newest first).
  router.get('/:idOrSlug/gifs', async (req, res, next) => {
    try {
      const { limit, offset } = parsePagination(req.query);

      const category = await repository.findCategory(req.params.idOrSlug);
      if (!category) {
        throw new HttpError(404, `Category not found: ${req.params.idOrSlug}`);
      }

      const page = await repository.listGifsByCategory(category.id, { limit, offset });

      res.json({
        data: page.items,
        category,
        pagination: { limit: page.limit, offset: page.offset, total: page.total },
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/categories/:idOrSlug (L42-444)
  //
  // 404 if the category doesn't exist. 409 `{ error, code: 'category_has_generation_prompts',
  // details: { blockingPromptCount } }` if it still has `generation_prompts` rows - that FK is
  // `ON DELETE RESTRICT` on purpose (ADR-0001), so this never cascades and never 500s. `gifs`
  // pointing at the category are un-categorized automatically (`ON DELETE SET NULL`).
  //
  // Retirement procedure for a category that still has generation_prompts: (1) set
  // `is_active = false` on its prompts (stops new generation, keeps the audit trail - does NOT
  // delete anything and does NOT unblock this endpoint), (2) once retention allows, delete those
  // now-inactive rows ("purge"), (3) retry this DELETE, which will now succeed. See
  // docs/database-schema.md#category-retirement.
  router.delete('/:idOrSlug', async (req, res, next) => {
    try {
      await repository.deleteCategory(req.params.idOrSlug);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

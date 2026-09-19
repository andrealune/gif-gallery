/**
 * Selects which `GifSearchQueryServiceLike` backend `GET /api/search` uses (L42-463) - see
 * docs/elasticsearch.md's "Postgres fallback" section for the ranking-quality tradeoff, and
 * `config/env.ts`'s `search.backend`/`elasticsearch.syncEnabled` for the two env vars this reads.
 */
import { env } from '../config/env';
import { PostgresGifSearchQueryService } from './postgresSearchService';
import { GifSearchQueryService, type GifSearchQueryServiceLike } from './searchService';

export type SearchBackend = 'elasticsearch' | 'postgres';

/**
 * Just the shape `resolveSearchBackend`/`createGifSearchQueryService` need - not `config/env.ts`'s full
 * `Env` type - so tests can pass a minimal fake instead of every other unrelated env setting.
 * `env` itself satisfies this structurally.
 */
export interface SearchBackendEnv {
  search: { backend: 'elasticsearch' | 'postgres' | 'auto' };
  elasticsearch: { syncEnabled: boolean };
}

/**
 * `SEARCH_BACKEND=elasticsearch`/`postgres` force that backend outright - `elasticsearch` still fails
 * at query time if the cluster is unreachable/misconfigured (`search/client.ts`), exactly as it did
 * before this switch existed. `auto` (the default) infers from `ELASTICSEARCH_SYNC_ENABLED` - the flag
 * every environment already sets to say whether it has a real cluster wired up (ADR 0001: every preview
 * sets it `false` and has no Elasticsearch service at all) - rather than probing the cluster on every
 * request, which the issue this implements explicitly calls out as the less preferred option.
 */
export function resolveSearchBackend(cfg: SearchBackendEnv = env): SearchBackend {
  if (cfg.search.backend === 'elasticsearch' || cfg.search.backend === 'postgres') {
    return cfg.search.backend;
  }
  return cfg.elasticsearch.syncEnabled ? 'elasticsearch' : 'postgres';
}

/** Builds the `GifSearchQueryServiceLike` `routes/search.ts` uses by default, per `resolveSearchBackend`. */
export function createGifSearchQueryService(cfg: SearchBackendEnv = env): GifSearchQueryServiceLike {
  return resolveSearchBackend(cfg) === 'postgres' ? new PostgresGifSearchQueryService() : new GifSearchQueryService();
}

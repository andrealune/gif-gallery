/**
 * Public surface of the search integration. Route handlers / the sync job
 * (L42-419) should import from here rather than reaching into individual
 * files.
 */
export { checkElasticsearchConnection, closeElasticsearchClient, createElasticsearchClient, getElasticsearchClient } from './client';
export { createGifSearchQueryService, resolveSearchBackend, type SearchBackend } from './backend';
export { toGifDocument, type GifSearchDocument, type GifSearchSourceRow } from './documentMapper';
export { ElasticsearchClientError, ElasticsearchConfigError, IndexingPipelineError } from './errors';
export { GIF_COLUMNS, mapGif, qualifiedGifColumns, type GifRow } from './gifRowMapper';
export { GIFS_INDEX_MAPPING, buildGifsIndexSettings, parseIndexVersion, versionedIndexName } from './gifsIndex';
export {
  GIFS_ALIAS,
  createGifsIndex,
  currentAliasTarget,
  listVersionedIndices,
  nextIndexVersion,
  pruneOldIndices,
  reindexAllGifs,
  runReindexPipeline,
  swapAlias,
  type ReindexResult,
  type RunReindexPipelineOptions,
  type RunReindexPipelineResult,
} from './pipeline';
export { PostgresGifSearchFallback } from './postgresFallback';
export { PostgresGifSearchQueryService } from './postgresSearchService';
export {
  GifSearchSourceRepository,
  type GifSearchSourceRepositoryLike,
  type GifSearchSyncRepositoryLike,
  type GifSyncCursor,
} from './repository';
export { buildSearchRequest, type GifSearchQueryParams } from './searchQuery';
export {
  GifSearchQueryService,
  type GifSearchFallbackLike,
  type GifSearchQueryServiceLike,
  type SearchGifsResult,
} from './searchService';
export {
  createGifSearchSyncJob,
  runSyncBatch,
  type GifSearchSyncJob,
  type GifSearchSyncJobOptions,
  type RunSyncBatchParams,
  type RunSyncBatchResult,
} from './syncJob';

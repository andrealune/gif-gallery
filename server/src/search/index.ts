/**
 * Public surface of the Elasticsearch search integration. Route handlers /
 * the future sync job (L42-419) should import from here rather than reaching
 * into individual files.
 */
export { checkElasticsearchConnection, closeElasticsearchClient, createElasticsearchClient, getElasticsearchClient } from './client';
export { toGifDocument, type GifSearchDocument, type GifSearchSourceRow } from './documentMapper';
export { ElasticsearchClientError, ElasticsearchConfigError, IndexingPipelineError } from './errors';
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
export { GifSearchSourceRepository, type GifSearchSourceRepositoryLike } from './repository';

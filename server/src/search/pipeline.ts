/**
 * Index lifecycle + the bulk indexing pipeline: create a versioned index,
 * fill it from Postgres, atomically swap the `gifs` alias onto it, and prune
 * old versions. See `docs/elasticsearch.md` for the operational rationale
 * (why an alias, how to roll back, how this scales to 100k documents).
 *
 * This module intentionally only *builds* an index end to end (used by the
 * `search:reindex` CLI for the initial bulk load / a full rebuild). Keeping
 * an already-live index in sync with individual gif create/update/delete
 * calls is the ongoing "database-to-Elasticsearch sync" (L42-419); that
 * work can reuse `toGifDocument` and `GIFS_ALIAS`/index helpers from here
 * rather than duplicating them.
 */
import type { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';
import { toGifDocument, type GifSearchDocument } from './documentMapper';
import { IndexingPipelineError } from './errors';
import { buildGifsIndexSettings, GIFS_INDEX_MAPPING, parseIndexVersion, versionedIndexName } from './gifsIndex';
import { GifSearchSourceRepository, type GifSearchSourceRepositoryLike } from './repository';

export const GIFS_ALIAS = env.elasticsearch.indexAlias;

export interface CreateIndexOptions {
  shards?: number;
  replicas?: number;
}

/** Creates `indexName` with the `gifs` mapping if it does not already exist. Idempotent. */
export async function createGifsIndex(client: Client, indexName: string, options: CreateIndexOptions = {}): Promise<void> {
  const exists = await client.indices.exists({ index: indexName });
  if (exists) return;

  await client.indices.create({
    index: indexName,
    settings: buildGifsIndexSettings({
      shards: options.shards ?? env.elasticsearch.indexShards,
      replicas: options.replicas ?? env.elasticsearch.indexReplicas,
    }),
    mappings: GIFS_INDEX_MAPPING,
  });
}

/** Every existing `<alias>_v<N>` index, sorted oldest first. */
export async function listVersionedIndices(client: Client, alias: string): Promise<string[]> {
  try {
    const response = await client.indices.get({ index: `${alias}_v*` }, { ignore: [404] });
    return Object.keys(response).sort(
      (a, b) => (parseIndexVersion(alias, a) ?? 0) - (parseIndexVersion(alias, b) ?? 0)
    );
  } catch {
    return [];
  }
}

/** The version number to use for the *next* index to build (1 if none exist yet). */
export async function nextIndexVersion(client: Client, alias: string): Promise<number> {
  const indices = await listVersionedIndices(client, alias);
  const versions = indices.map((name) => parseIndexVersion(alias, name) ?? 0);
  return versions.length ? Math.max(...versions) + 1 : 1;
}

/** The index the alias currently points at, or null if the alias does not exist yet. */
export async function currentAliasTarget(client: Client, alias: string): Promise<string | null> {
  try {
    const response = await client.indices.getAlias({ name: alias }, { ignore: [404] });
    const [indexName] = Object.keys(response);
    return indexName ?? null;
  } catch {
    return null;
  }
}

/** Atomically repoints `alias` at `targetIndex` (and only `targetIndex`) -- zero-downtime for readers. */
export async function swapAlias(client: Client, alias: string, targetIndex: string): Promise<void> {
  const previousTarget = await currentAliasTarget(client, alias);
  const actions: Record<string, { index: string; alias: string }>[] = [];
  if (previousTarget && previousTarget !== targetIndex) {
    actions.push({ remove: { index: previousTarget, alias } });
  }
  actions.push({ add: { index: targetIndex, alias } });
  await client.indices.updateAliases({ actions });
}

export interface ReindexResult {
  targetIndex: string;
  indexed: number;
  failed: number;
}

/**
 * Streams every active gif out of Postgres (keyset-paginated, see
 * `repository.ts`) and bulk-indexes it into `targetIndex` using the client's
 * `helpers.bulk`, which batches, retries transient failures with backoff and
 * applies backpressure -- appropriate for the 10k-100k document range this
 * pipeline targets without loading the whole result set into memory at once.
 */
export async function reindexAllGifs(params: {
  client: Client;
  targetIndex: string;
  sourceRepository?: GifSearchSourceRepositoryLike;
  batchSize?: number;
  onProgress?: (indexed: number) => void;
}): Promise<ReindexResult> {
  const sourceRepository = params.sourceRepository ?? new GifSearchSourceRepository();
  const batchSize = params.batchSize ?? env.elasticsearch.reindexBatchSize;

  async function* documents(): AsyncGenerator<GifSearchDocument> {
    let afterId: string | null = null;
    for (;;) {
      const rows = await sourceRepository.fetchBatch(afterId, batchSize);
      if (rows.length === 0) return;
      for (const row of rows) {
        yield toGifDocument(row);
      }
      afterId = rows[rows.length - 1].id;
      if (rows.length < batchSize) return;
    }
  }

  let indexed = 0;
  const result = await params.client.helpers.bulk<GifSearchDocument>({
    datasource: documents(),
    onDocument(doc) {
      indexed += 1;
      params.onProgress?.(indexed);
      return { index: { _index: params.targetIndex, _id: doc.id } };
    },
    refreshOnCompletion: params.targetIndex,
  });

  if (result.failed > 0) {
    throw new IndexingPipelineError(
      `Reindex into ${params.targetIndex} finished with ${result.failed} failed document(s) ` +
        `out of ${result.total} (see result.failedDocuments for detail)`
    );
  }

  return { targetIndex: params.targetIndex, indexed: result.successful, failed: result.failed };
}

/** Deletes every versioned index except `keep` most recent ones and whichever index the alias currently points at. */
export async function pruneOldIndices(client: Client, alias: string, keep: number): Promise<string[]> {
  const indices = await listVersionedIndices(client, alias); // oldest first
  const activeIndex = await currentAliasTarget(client, alias);
  const deletable = indices.filter((name) => name !== activeIndex);
  const toDelete = deletable.slice(0, Math.max(deletable.length - keep, 0));

  for (const indexName of toDelete) {
    await client.indices.delete({ index: indexName });
  }
  return toDelete;
}

export interface RunReindexPipelineOptions {
  client: Client;
  alias?: string;
  batchSize?: number;
  shards?: number;
  replicas?: number;
  /** How many previous (inactive) versioned indices to keep for manual rollback. Default 1. */
  keepPreviousIndices?: number;
  onProgress?: (indexed: number) => void;
}

export interface RunReindexPipelineResult extends ReindexResult {
  alias: string;
  previousIndex: string | null;
  prunedIndices: string[];
}

/** Full pipeline: build a new versioned index, fill it, swap the alias onto it, prune old versions. */
export async function runReindexPipeline(options: RunReindexPipelineOptions): Promise<RunReindexPipelineResult> {
  const alias = options.alias ?? GIFS_ALIAS;
  const previousIndex = await currentAliasTarget(options.client, alias);
  const version = await nextIndexVersion(options.client, alias);
  const targetIndex = versionedIndexName(alias, version);

  await createGifsIndex(options.client, targetIndex, { shards: options.shards, replicas: options.replicas });

  const result = await reindexAllGifs({
    client: options.client,
    targetIndex,
    batchSize: options.batchSize,
    onProgress: options.onProgress,
  });

  await swapAlias(options.client, alias, targetIndex);
  const prunedIndices = await pruneOldIndices(options.client, alias, options.keepPreviousIndices ?? 1);

  return { ...result, alias, previousIndex, prunedIndices };
}

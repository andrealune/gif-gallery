/**
 * Keeps the `gifs` Elasticsearch index in sync with individual Postgres
 * create/update/(soft-)delete calls, as a complement to the full rebuild
 * pipeline in `pipeline.ts`/`reindex.ts`. This is the sync mechanism
 * L42-419 asks for.
 *
 * Chosen approach: a polling **custom job scheduler** (this module) over
 * Logstash's JDBC input plugin -- the app already owns a small, well-typed
 * Elasticsearch integration (`src/search/`) with no other infra
 * dependencies; adding Logstash would mean deploying/operating a second
 * service, duplicating the document mapping (`documentMapper.ts`) in its
 * config DSL, and losing type safety, for a catalog this module's own docs
 * size at 10k-100k documents (see `gifsIndex.ts`) -- well within what a
 * plain polling loop handles comfortably.
 *
 * How it works: repeatedly asks `GifSearchSourceRepository#fetchChanges`
 * (keyset-paginated on `(updated_at, id)`, see `repository.ts`) for every
 * gif whose `updated_at` moved past a cursor kept in memory, and applies
 * each one to the `gifs` alias with a single bulk request:
 *   - `status = 'active'`      -> upsert (`toGifDocument` -> index by id)
 *   - any other status         -> delete by id (archived/flagged/soft-deleted)
 * Because it drives off `updated_at` rather than being called from each
 * write site, it covers every current and future way a gif row changes
 * (the Tenor importer today, AI-generated/uploaded gifs or an admin API
 * later) with no risk of a call site forgetting to notify it.
 *
 * This is a *complement* to, not a replacement for, `search:reindex`: the
 * cursor is in-memory only, so a restart re-syncs a `startupOverlapMs`-wide
 * window of recent changes (harmless -- upserts/deletes are idempotent) but
 * anything older than that window that happened while the process was down
 * is only caught by the next full reindex. Run `npm run search:reindex`
 * periodically (e.g. a nightly cron) as the reconciliation safety net, the
 * same way it already is for the initial load (see docs/elasticsearch.md).
 */
import type { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';
import { toGifDocument, type GifSearchSourceRow } from './documentMapper';
import { IndexingPipelineError } from './errors';
import { GIFS_ALIAS } from './pipeline';
import {
  GifSearchSourceRepository,
  type GifSearchSyncRepositoryLike,
  type GifSyncCursor,
} from './repository';

export type { GifSyncCursor } from './repository';

/** The lowest possible UUID -- every real gif id sorts after it. Used to build a cursor pinned to an exact `updated_at` without a nullable "and any id" case. */
const MIN_UUID = '00000000-0000-0000-0000-000000000000';

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowCursor(row: GifSearchSourceRow): GifSyncCursor {
  return { updatedAt: toIsoString(row.updated_at), id: row.id };
}

export interface RunSyncBatchParams {
  client: Client;
  alias?: string;
  sourceRepository?: GifSearchSyncRepositoryLike;
  /** Resume point from the previous batch, or `null` to start from the very first change ever recorded. */
  cursor: GifSyncCursor | null;
  batchSize?: number;
}

export interface RunSyncBatchResult {
  /** Cursor to pass into the next call. Unchanged from the input when `processed` is 0. */
  cursor: GifSyncCursor | null;
  /** Number of changed rows fetched this call (upserts + deletes). */
  processed: number;
  indexed: number;
  deleted: number;
}

/**
 * Fetches and applies one page of changes. Callers loop (see
 * `createGifSearchSyncJob`) until `processed` comes back smaller than the
 * requested `batchSize`, the same "shorter page ends the loop" convention
 * `reindexAllGifs` uses.
 */
export async function runSyncBatch(params: RunSyncBatchParams): Promise<RunSyncBatchResult> {
  const alias = params.alias ?? GIFS_ALIAS;
  const sourceRepository = params.sourceRepository ?? new GifSearchSourceRepository();
  const batchSize = params.batchSize ?? env.elasticsearch.syncBatchSize;

  const rows = await sourceRepository.fetchChanges(params.cursor, batchSize);
  if (rows.length === 0) {
    return { cursor: params.cursor, processed: 0, indexed: 0, deleted: 0 };
  }

  let indexed = 0;
  let deleted = 0;
  const unexpectedDrops: unknown[] = [];

  await params.client.helpers.bulk<GifSearchSourceRow>({
    datasource: rows,
    onDocument(row) {
      if (row.status === 'active') {
        indexed += 1;
        return [{ index: { _index: alias, _id: row.id } }, toGifDocument(row)];
      }
      deleted += 1;
      return { delete: { _index: alias, _id: row.id } };
    },
    onDrop(dropped) {
      const operation = Array.isArray(dropped.operation) ? dropped.operation[0] : dropped.operation;
      // A delete for a document that was never indexed (e.g. a gif archived
      // before ever having been active) 404s -- that IS the desired end
      // state, not a failure worth surfacing/retrying.
      const isBenignMissingDelete = 'delete' in operation && dropped.status === 404;
      if (!isBenignMissingDelete) unexpectedDrops.push(dropped);
    },
  });

  if (unexpectedDrops.length > 0) {
    throw new IndexingPipelineError(
      `Sync batch into "${alias}" failed to apply ${unexpectedDrops.length} of ${rows.length} change(s)`
    );
  }

  return { cursor: rowCursor(rows[rows.length - 1]), processed: rows.length, indexed, deleted };
}

export interface GifSearchSyncJobOptions {
  client: Client;
  alias?: string;
  sourceRepository?: GifSearchSyncRepositoryLike;
  /** Rows fetched per page; defaults to `ELASTICSEARCH_SYNC_BATCH_SIZE`. */
  batchSize?: number;
  /** How long to wait between drained polls; defaults to `ELASTICSEARCH_SYNC_INTERVAL_MS`. */
  intervalMs?: number;
  /**
   * How far back from "now" to set the cursor on first start (when
   * `initialCursor` is not given), so changes racing with process startup
   * are still caught. Defaults to `ELASTICSEARCH_SYNC_STARTUP_OVERLAP_MS`.
   */
  startupOverlapMs?: number;
  /** Explicit starting cursor. `null` re-syncs every gif ever recorded (like a reindex, but one row-write at a time -- rarely what you want; omit this instead). */
  initialCursor?: GifSyncCursor | null;
  onBatch?: (result: RunSyncBatchResult) => void;
  onError?: (error: unknown) => void;
  /** Injectable for tests; defaults to a real `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface GifSearchSyncJob {
  /** Starts polling in the background. A no-op if already started. */
  start(): void;
  /** Stops after the in-flight batch (if any) finishes; safe to call even if never started. */
  stop(): Promise<void>;
  readonly cursor: GifSyncCursor | null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds (but does not start) a background job that keeps polling
 * `runSyncBatch` forever: drains every available page, waits `intervalMs`,
 * repeats. A batch that throws (e.g. the cluster is briefly unreachable) is
 * reported via `onError` and retried from the same cursor next tick --
 * upserts/deletes are idempotent, so re-processing a page is always safe.
 */
export function createGifSearchSyncJob(options: GifSearchSyncJobOptions): GifSearchSyncJob {
  const alias = options.alias ?? GIFS_ALIAS;
  const sourceRepository = options.sourceRepository ?? new GifSearchSourceRepository();
  const batchSize = options.batchSize ?? env.elasticsearch.syncBatchSize;
  const intervalMs = options.intervalMs ?? env.elasticsearch.syncIntervalMs;
  const startupOverlapMs = options.startupOverlapMs ?? env.elasticsearch.syncStartupOverlapMs;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date());

  let cursor: GifSyncCursor | null =
    options.initialCursor !== undefined
      ? options.initialCursor
      : { updatedAt: new Date(now().getTime() - startupOverlapMs).toISOString(), id: MIN_UUID };

  let running = false;
  let loopPromise: Promise<void> | null = null;

  async function drain(): Promise<void> {
    for (;;) {
      const result = await runSyncBatch({ client: options.client, alias, sourceRepository, cursor, batchSize });
      cursor = result.cursor;
      if (result.processed > 0) options.onBatch?.(result);
      if (result.processed < batchSize) return;
      if (!running) return;
    }
  }

  async function loop(): Promise<void> {
    while (running) {
      try {
        await drain();
      } catch (error) {
        options.onError?.(error);
      }
      if (!running) return;
      await sleep(intervalMs);
    }
  }

  return {
    get cursor() {
      return cursor;
    },
    start() {
      if (running) return;
      running = true;
      loopPromise = loop();
    },
    async stop() {
      running = false;
      await loopPromise;
      loopPromise = null;
    },
  };
}

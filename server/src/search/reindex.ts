/**
 * Full (re)indexing pipeline: builds a brand-new versioned `gifs_v<N>`
 * index from every *active* row currently in Postgres, atomically swaps the
 * `gifs` alias onto it once it is fully populated, then prunes old
 * versions. Safe to run against a cluster that is already serving traffic
 * -- readers keep hitting the old index until the swap, which is atomic.
 *
 * Rollback: the previous version is kept (by default) after a run. If the
 * new index turns out to be bad, repoint the alias back manually:
 *
 *   curl -X POST "$ELASTICSEARCH_NODE/_aliases" -H 'content-type: application/json' -d '{
 *     "actions": [
 *       { "remove": { "index": "gifs_v2", "alias": "gifs" } },
 *       { "add":    { "index": "gifs_v1", "alias": "gifs" } }
 *     ]
 *   }'
 *
 * Usage (from server/):
 *   npm run search:reindex
 *   npm run search:reindex -- --no-prune     # keep every old version
 *   npm run search:reindex -- --keep 3       # keep 3 previous versions instead of the default 1
 */
import { checkElasticsearchConnection, closeElasticsearchClient, getElasticsearchClient } from './client';
import { GIFS_ALIAS, runReindexPipeline } from './pipeline';
import { GifSearchSourceRepository } from './repository';

function parseArgs(argv: string[]): { keepPreviousIndices: number } {
  const noPrune = argv.includes('--no-prune');
  const keepIndex = argv.indexOf('--keep');
  const keepArg = keepIndex >= 0 ? Number(argv[keepIndex + 1]) : undefined;
  return { keepPreviousIndices: noPrune ? Infinity : keepArg && !Number.isNaN(keepArg) ? keepArg : 1 };
}

async function main(): Promise<void> {
  const { keepPreviousIndices } = parseArgs(process.argv.slice(2));
  const client = getElasticsearchClient();

  const connected = await checkElasticsearchConnection(client);
  if (!connected) {
    throw new Error(
      `Could not reach Elasticsearch. Check ELASTICSEARCH_NODE and that the cluster is running ` +
        `(see docker-compose.yml for local dev).`
    );
  }

  const sourceRepository = new GifSearchSourceRepository();
  const total = await sourceRepository.countActive();
  // eslint-disable-next-line no-console
  console.log(`Reindexing ${total} active gif(s) into a new "${GIFS_ALIAS}" index version...`);

  let lastLogged = 0;
  const result = await runReindexPipeline({
    client,
    keepPreviousIndices,
    onProgress: (indexed) => {
      if (indexed - lastLogged >= 1000 || indexed === total) {
        // eslint-disable-next-line no-console
        console.log(`  indexed ${indexed}/${total}`);
        lastLogged = indexed;
      }
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    `Done. Indexed ${result.indexed} document(s) into "${result.targetIndex}" and repointed alias ` +
      `"${result.alias}" onto it (was "${result.previousIndex ?? '(none)'}"${
        result.prunedIndices.length ? `, pruned [${result.prunedIndices.join(', ')}]` : ''
      }).`
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Reindex failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeElasticsearchClient());

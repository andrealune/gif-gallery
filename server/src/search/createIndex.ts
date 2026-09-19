/**
 * Bootstraps the `gifs` search index without touching data: creates
 * `gifs_v1` (or the next unused version) with the current mapping/settings
 * and, if the `gifs` alias does not exist yet, points it there.
 *
 * Use this to stand up an *empty* index (e.g. right after `docker compose
 * up` on a fresh cluster). To (re)populate it from Postgres, run
 * `npm run search:reindex` instead -- that also creates the index if
 * needed, so this script is optional but useful for verifying connectivity
 * and the mapping in isolation.
 *
 * Usage (from server/):
 *   npm run search:create-index
 */
import { checkElasticsearchConnection, closeElasticsearchClient, getElasticsearchClient } from './client';
import { createGifsIndex, currentAliasTarget, GIFS_ALIAS, nextIndexVersion, swapAlias } from './pipeline';
import { versionedIndexName } from './gifsIndex';

async function main(): Promise<void> {
  const client = getElasticsearchClient();

  const connected = await checkElasticsearchConnection(client);
  if (!connected) {
    throw new Error(
      `Could not reach Elasticsearch. Check ELASTICSEARCH_NODE and that the cluster is running ` +
        `(see docker-compose.yml for local dev).`
    );
  }

  const existingTarget = await currentAliasTarget(client, GIFS_ALIAS);
  if (existingTarget) {
    // eslint-disable-next-line no-console
    console.log(`Alias "${GIFS_ALIAS}" already points at "${existingTarget}" -- nothing to do.`);
    return;
  }

  const version = await nextIndexVersion(client, GIFS_ALIAS);
  const indexName = versionedIndexName(GIFS_ALIAS, version);

  // eslint-disable-next-line no-console
  console.log(`Creating index "${indexName}" with the gifs mapping...`);
  await createGifsIndex(client, indexName);

  // eslint-disable-next-line no-console
  console.log(`Pointing alias "${GIFS_ALIAS}" at "${indexName}"...`);
  await swapAlias(client, GIFS_ALIAS, indexName);

  // eslint-disable-next-line no-console
  console.log('Done. The index is empty -- run `npm run search:reindex` to populate it from Postgres.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to create the gifs index:', err);
    process.exitCode = 1;
  })
  .finally(() => closeElasticsearchClient());

/**
 * Builds the Elasticsearch request body for `GET /api/search` (L42-420).
 *
 * Ranking: a `multi_match` across the fields the issue/`gifsIndex.ts` care
 * about for relevance - `title` (boosted, it's the strongest relevance
 * signal), `description`, `tags.text` and `category.name` - all using the
 * `english` analyzer set up in `gifsIndex.ts` (stemming/stopwords). `type:
 * 'best_fields'` (the default multi_match behaviour) uses the single
 * best-matching field's score per document with a `tie_breaker` so matches
 * across several fields still rank above a single-field match; `fuzziness:
 * 'AUTO'` tolerates small typos ("bday" vs "birthday" length-scaled
 * edit distance) without a separate suggester.
 *
 * Filtering: always restricts to `status: 'active'` (documents in the index
 * should already only be active - `syncJob.ts` deletes anything else - but
 * this is cheap insurance against a race during a reindex). `category` is
 * optional (the issue: "Include filtering by category if desired") and
 * matches either the category's id or its slug, same dual lookup
 * `routes/categories.ts` already does for `:idOrSlug`.
 *
 * `_source: false` - only ids/scores are needed; the route hydrates the
 * full, display-ready `GifSummary` rows from Postgres (see
 * `searchService.ts`) so the response always reflects the fields the
 * frontend's `GifSummary` contract needs (width/height/mimeType/... -
 * `gifsIndex.ts`'s document deliberately doesn't carry those, they're not
 * used for ranking).
 */
import type { SearchRequest, QueryDslQueryContainer, Sort } from '@elastic/elasticsearch/lib/api/types';

// Same UUID shape `services/categories/repository.ts#isUuid` matches, so a `category=`
// value is treated as an id when it looks like one and as a slug otherwise.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GifSearchQueryParams {
  q: string;
  /** A category id (UUID) or slug. Omitted/undefined means "every category". */
  category?: string;
  limit: number;
  offset: number;
}

const SEARCH_FIELDS = ['title^3', 'description', 'tags.text', 'category.name'];

function buildCategoryFilter(category: string): QueryDslQueryContainer {
  return UUID_RE.test(category) ? { term: { 'category.id': category } } : { term: { 'category.slug': category } };
}

/** Builds the full `client.search()` request for a page of ranked, optionally category-filtered results. */
export function buildSearchRequest(index: string, params: GifSearchQueryParams): SearchRequest {
  const filter: QueryDslQueryContainer[] = [{ term: { status: 'active' } }];
  if (params.category) {
    filter.push(buildCategoryFilter(params.category));
  }

  const sort: Sort = ['_score', { updatedAt: 'desc' }];

  return {
    index,
    from: params.offset,
    size: params.limit,
    track_total_hits: true,
    _source: false,
    sort,
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query: params.q,
              fields: SEARCH_FIELDS,
              type: 'best_fields',
              fuzziness: 'AUTO',
              tie_breaker: 0.3,
            },
          },
        ],
        filter,
      },
    },
  };
}

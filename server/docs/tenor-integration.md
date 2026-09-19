# Tenor API v2 integration

The backend imports popular GIF metadata from Tenor's v2 `featured` endpoint and stores it in
`gifs` plus `third_party_references`. It stores provider URLs and metadata; it does **not** copy or
proxy media files. Existing rows are refreshed idempotently using the schema's unique
`(provider, external_id)` key.

## Provider contract

This implementation follows the current Tenor v2 documentation:

- `GET https://tenor.googleapis.com/v2/featured`
- pagination uses the opaque response `next` value as the next request's `pos`; it is never treated
  as a numeric offset
- `limit` is 1–50, `media_filter=gif,tinygif`, and the default content filter is `high` (G-rated)
- the default Tenor quota is 1 request/second
- cached content URLs must be refreshed at least every 24 hours and response `Cache-Control` must
  be respected by any HTTP cache in front of this service
- displayed content must include Tenor attribution (the stored reference contains
  `Powered By Tenor`)

**Lifecycle warning:** Tenor stopped accepting new API clients on January 13, 2026 and announced
that every current integration will be decommissioned on June 30, 2026. This adapter therefore only
provides a short-lived path for an existing Tenor API client. Do not attempt to use a GIPHY key:
GIPHY's current standard terms require Trending calls to be client-side and prohibit server-side
caching/storage without written approval. A replacement provider/contract must be approved before
Tenor's shutdown date.

References:

- https://developers.google.com/tenor/guides/endpoints#featured
- https://developers.google.com/tenor/guides/response-objects-and-errors
- https://developers.google.com/tenor/guides/rate-limits-and-caching
- https://developers.google.com/tenor/guides/attribution
- https://support.google.com/tenor/answer/10455265

## Configuration

Set `TENOR_API_KEY` through the deployment secret manager. Never commit or log it.
`TENOR_CLIENT_KEY` identifies this integration and should remain stable. Timeout, retry backoff, and local requests/second are configurable through the variables
documented in `.env.example`. The client rejects non-Tenor endpoints so a misconfiguration cannot
forward the query-string credential to another host.

## Failure behavior

Every request has an abort timeout. Network failures, timeouts, HTTP 408/425/429, and selected
5xx statuses are retried with capped exponential jitter. `Retry-After` is honored up to 30 seconds.
Authentication and validation errors fail immediately. Error messages contain only status codes,
never request URLs, so query-string credentials cannot leak into logs.

Imports are safe to rerun. Each item is written in a transaction under a provider-ID advisory lock;
existing rows and their `fetched_at` timestamp are refreshed rather than duplicated. A failed item
rolls back its complete transaction. Schedule a refresh at least every 24 hours if Tenor URLs remain
published.

## Usage

```ts
import { createTenorImporter } from './services/tenor';

const summary = await createTenorImporter().importFeatured({
  pages: 2,
  limit: 20,
  contentFilter: 'high',
  country: 'US',
  locale: 'en_US',
});
```

The returned `next` token can resume pagination later by passing it as `position`. Do not expose the
provider API key or raw provider request URL in an API response.

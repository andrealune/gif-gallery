import type { Readable } from 'stream';

export interface PutObjectInput {
  /** Storage key / path, e.g. "gifs/2024/07/abc123.gif". No leading slash. */
  key: string;
  body: Buffer | Readable;
  contentType?: string;
  /** Defaults to a long-lived immutable cache header; GIF keys are content-addressed. */
  cacheControl?: string;
}

export interface PutObjectResult {
  key: string;
  /** Public-facing URL for the object (the CDN URL, when one is configured). */
  url: string;
}

/**
 * Storage backend contract. `src/storage/index.ts` picks an implementation
 * based on `STORAGE_PROVIDER` so callers (the GIF generation/upload routes
 * added by later tasks) never talk to a specific driver directly.
 */
export interface StorageClient {
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  /** Removes an object. Resolves without error if it does not exist. */
  deleteObject(key: string): Promise<void>;
  /** The public (CDN-fronted, when configured) URL for a key. */
  getPublicUrl(key: string): string;
  /** A time-limited signed URL, for private access without a public/CDN path. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Verifies the backing store is reachable/writable. Used by health checks. */
  checkHealth(): Promise<boolean>;
}

/**
 * File storage for the batch generation scheduler (L42-424), adapted onto
 * `src/storage`'s `StorageClient` abstraction (L42-425) so a generated GIF
 * actually lands in S3 (+ is served through the CloudFront CDN) once
 * `STORAGE_PROVIDER=s3` is configured, with no change needed by the
 * scheduler itself - it only depends on the narrow `GifStorage` interface
 * below. See `src/storage/` and `infra/terraform/storage` for the
 * S3/CloudFront setup this pairs with in staging/production.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { env } from '../../config/env';
import { s3Storage } from '../../storage/s3Storage';
import type { StorageClient } from '../../storage/types';

export interface StoredFile {
  /** Publicly-reachable URL the stored file can be retrieved from. */
  url: string;
  /**
   * Where it lives: an absolute filesystem path for the local provider, or
   * the object's storage key for the s3 provider (there is no filesystem
   * path in that case - the key is what identifies/locates the object).
   */
  storagePath: string;
  sizeBytes: number;
}

export interface GifStorage {
  save(buffer: Buffer, filename: string, mimeType?: string): Promise<StoredFile>;
}

/** Rejects a filename that isn't a plain, single-segment name (defends `save()` against path traversal). */
export function assertSafeFilename(filename: string): void {
  if (!filename || filename !== path.basename(filename) || filename.includes('..')) {
    throw new TypeError(`Unsafe storage filename: ${JSON.stringify(filename)}`);
  }
}

export class LocalGifStorage implements GifStorage {
  constructor(private readonly baseDir: string = env.storage.localDir) {}

  async save(buffer: Buffer, filename: string, _mimeType?: string): Promise<StoredFile> {
    assertSafeFilename(filename);
    await fs.mkdir(this.baseDir, { recursive: true });
    const storagePath = path.join(this.baseDir, filename);
    await fs.writeFile(storagePath, buffer);
    return {
      url: `${env.seo.siteUrl}/storage/${filename}`,
      storagePath,
      sizeBytes: buffer.length,
    };
  }
}

/**
 * Adapts `src/storage`'s `StorageClient` (S3, or any other future driver
 * picked by `STORAGE_PROVIDER`) onto the narrower `GifStorage` interface the
 * generation scheduler depends on.
 */
export class ClientBackedGifStorage implements GifStorage {
  constructor(private readonly client: Pick<StorageClient, 'putObject'> = s3Storage) {}

  async save(buffer: Buffer, filename: string, mimeType?: string): Promise<StoredFile> {
    assertSafeFilename(filename);
    const { key, url } = await this.client.putObject({
      key: filename,
      body: buffer,
      contentType: mimeType,
    });
    return { url, storagePath: key, sizeBytes: buffer.length };
  }
}

/**
 * Builds the process-wide storage adapter from environment configuration.
 * `STORAGE_PROVIDER=local` (the default) writes to disk directly;
 * `STORAGE_PROVIDER=s3` (or any other provider `src/storage` supports)
 * delegates to that abstraction, e.g. uploading to S3 and returning a
 * CloudFront-fronted URL when `CDN_BASE_URL` is set.
 */
export function createGifStorageFromEnv(): GifStorage {
  return env.storage.provider === 'local' ? new LocalGifStorage() : new ClientBackedGifStorage(s3Storage);
}

export const gifStorage = createGifStorageFromEnv();

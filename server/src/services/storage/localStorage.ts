/**
 * Minimal file storage for the batch generation scheduler (L42-424).
 *
 * This is deliberately the smallest thing that lets a generated GIF be
 * persisted and served end-to-end today (local disk, served back out under
 * `/storage` - see `src/app.ts`). It is **not** the full storage
 * abstraction described in `src/config/env.ts`'s `storage` block (S3
 * support, CDN URLs, per-provider retry/error handling, etc.) - that is
 * L42-425's job. Callers (the generation scheduler) only depend on the
 * `GifStorage` interface, so swapping in an S3-backed implementation later
 * needs no change on their side.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { env } from '../../config/env';

export interface StoredFile {
  /** Publicly-reachable URL the stored file can be retrieved from. */
  url: string;
  /** Where it actually lives (only meaningful for the local provider). */
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
 * Builds the process-wide storage adapter from environment configuration.
 * `STORAGE_PROVIDER=s3` is accepted by config but not implemented yet
 * (L42-425); it falls back to local disk so the scheduler still works
 * end-to-end in the meantime.
 */
export function createGifStorageFromEnv(): GifStorage {
  return new LocalGifStorage();
}

export const gifStorage = createGifStorageFromEnv();

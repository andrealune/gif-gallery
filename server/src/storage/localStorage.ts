import { promises as fs, constants as fsConstants } from 'fs';
import path from 'path';
import type { Readable } from 'stream';
import { env } from '../config/env';
import type { PutObjectInput, PutObjectResult, StorageClient } from './types';

function baseDir(): string {
  return path.resolve(process.cwd(), env.storage.localDir);
}

function resolvePath(key: string): string {
  const base = baseDir();
  const target = path.resolve(base, key);
  // Defend against a key trying to escape the storage directory
  // (e.g. "../../etc/passwd").
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return target;
}

function publicUrl(key: string): string {
  const base = env.storage.publicBaseUrl.replace(/\/$/, '');
  return `${base}/${key}`;
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Filesystem-backed storage driver used for local development
 * (`STORAGE_PROVIDER=local`, the default). Files are written under
 * `STORAGE_LOCAL_DIR` (gitignored) and served back via the `/storage`
 * static route mounted in `app.ts`. Not intended for production use: it has
 * no access control, redundancy or CDN in front of it.
 */
export const localStorage: StorageClient = {
  async putObject({ key, body }: PutObjectInput): Promise<PutObjectResult> {
    const target = resolvePath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const buffer = Buffer.isBuffer(body) ? body : await readStreamToBuffer(body);
    await fs.writeFile(target, buffer);
    return { key, url: publicUrl(key) };
  },

  async deleteObject(key: string): Promise<void> {
    try {
      await fs.unlink(resolvePath(key));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  },

  getPublicUrl(key: string): string {
    return publicUrl(key);
  },

  async getSignedUrl(key: string): Promise<string> {
    // The local driver has no access control of its own; it simply returns
    // the same public URL. Real signed/private access is only meaningful
    // for the S3 driver.
    return publicUrl(key);
  },

  async checkHealth(): Promise<boolean> {
    try {
      const base = baseDir();
      await fs.mkdir(base, { recursive: true });
      await fs.access(base, fsConstants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
};

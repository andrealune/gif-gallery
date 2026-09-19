import { promises as fs } from 'fs';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { storage } from '../src/storage';

// These tests exercise the default "local" STORAGE_PROVIDER (see
// test/setup.ts / .env.example) so they need no network access or
// credentials. The S3 driver (src/storage/s3Storage.ts) is exercised
// manually against a real/staging bucket - see infra/terraform/storage.
describe('storage (local provider)', () => {
  const key = `test/${Date.now()}-sample.txt`;

  afterAll(async () => {
    await storage.deleteObject(key);
  });

  it('writes an object and returns a public URL containing its key', async () => {
    const result = await storage.putObject({
      key,
      body: Buffer.from('hello gif gallery'),
      contentType: 'text/plain',
    });

    expect(result.key).toBe(key);
    expect(result.url).toContain(key);

    const onDisk = path.resolve(process.cwd(), 'storage', key);
    await expect(fs.readFile(onDisk, 'utf8')).resolves.toBe('hello gif gallery');
  });

  it('getPublicUrl and getSignedUrl both resolve to the public URL', async () => {
    expect(storage.getPublicUrl(key)).toContain(key);
    await expect(storage.getSignedUrl(key)).resolves.toBe(storage.getPublicUrl(key));
  });

  it('deleteObject removes the file and is idempotent', async () => {
    await storage.deleteObject(key);
    const onDisk = path.resolve(process.cwd(), 'storage', key);
    await expect(fs.access(onDisk)).rejects.toThrow();
    // Deleting again must not throw (no-op for a missing key).
    await expect(storage.deleteObject(key)).resolves.toBeUndefined();
  });

  it('reports healthy when the local directory is writable', async () => {
    await expect(storage.checkHealth()).resolves.toBe(true);
  });
});

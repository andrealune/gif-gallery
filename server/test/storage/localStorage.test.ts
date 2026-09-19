import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalGifStorage, assertSafeFilename } from '../../src/services/storage/localStorage';

describe('LocalGifStorage', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  it('writes the buffer under the configured directory and returns a public URL', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gif-storage-'));
    dirs.push(dir);
    const storage = new LocalGifStorage(dir);

    const result = await storage.save(Buffer.from('gif-bytes'), 'example.gif', 'image/gif');

    expect(result.storagePath).toBe(path.join(dir, 'example.gif'));
    expect(result.sizeBytes).toBe(Buffer.byteLength('gif-bytes'));
    expect(result.url).toContain('/storage/example.gif');
    const written = await fs.readFile(result.storagePath, 'utf8');
    expect(written).toBe('gif-bytes');
  });

  it('creates the directory if it does not exist yet', async () => {
    const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'gif-storage-')), 'nested', 'dir');
    dirs.push(path.dirname(dir));
    const storage = new LocalGifStorage(dir);

    await storage.save(Buffer.from('x'), 'y.gif');

    await expect(fs.stat(path.join(dir, 'y.gif'))).resolves.toBeTruthy();
  });
});

describe('assertSafeFilename', () => {
  it('accepts a plain filename', () => {
    expect(() => assertSafeFilename('abc-123.gif')).not.toThrow();
  });

  it.each(['../escape.gif', '/etc/passwd', '', 'nested/path.gif'])('rejects %s', (filename) => {
    expect(() => assertSafeFilename(filename)).toThrow();
  });
});

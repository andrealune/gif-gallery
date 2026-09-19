import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ImageFetchError, InvalidImageInputError } from '../../src/services/gif/errors';
import { resolveImageInputs } from '../../src/services/gif/imageInput';
import {
  imageInputFromBase64,
  imageInputFromBuffer,
  imageInputFromFilePath,
  imageInputFromGeneratedImage,
  imageInputFromUrl,
} from '../../src/services/gif/types';

// 8x8 solid red PNG - small, hand-generated fixture; see server/README.md's
// note on the GIF pipeline for how test fixtures were produced.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEklEQVR4nGP4w8CAFWEXHbQSAN0wPwH0NrsUAAAAAElFTkSuQmCC';
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, 'base64');

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gif-imageinput-test-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('resolveImageInputs', () => {
  it('rejects an empty frame list', async () => {
    await withTempDir(async (dir) => {
      await expect(resolveImageInputs([], dir)).rejects.toBeInstanceOf(InvalidImageInputError);
    });
  });

  it('writes a buffer input to a numbered file and sniffs its extension', async () => {
    await withTempDir(async (dir) => {
      const [filePath] = await resolveImageInputs([imageInputFromBuffer(TINY_PNG_BUFFER)], dir);
      expect(filePath).toBe(path.join(dir, 'frame_0000.png'));
      expect(await fs.readFile(filePath)).toEqual(TINY_PNG_BUFFER);
    });
  });

  it('honors an explicit extension override for a buffer input', async () => {
    await withTempDir(async (dir) => {
      const [filePath] = await resolveImageInputs([imageInputFromBuffer(TINY_PNG_BUFFER, 'jpg')], dir);
      expect(filePath.endsWith('.jpg')).toBe(true);
    });
  });

  it('decodes a bare base64 string', async () => {
    await withTempDir(async (dir) => {
      const [filePath] = await resolveImageInputs([imageInputFromBase64(TINY_PNG_BASE64)], dir);
      expect(await fs.readFile(filePath)).toEqual(TINY_PNG_BUFFER);
    });
  });

  it('decodes a data: URL base64 string', async () => {
    await withTempDir(async (dir) => {
      const [filePath] = await resolveImageInputs(
        [imageInputFromBase64(`data:image/png;base64,${TINY_PNG_BASE64}`)],
        dir
      );
      expect(await fs.readFile(filePath)).toEqual(TINY_PNG_BUFFER);
    });
  });

  it('rejects an undecodable base64 payload that decodes to zero bytes', async () => {
    await withTempDir(async (dir) => {
      await expect(resolveImageInputs([imageInputFromBase64('')], dir)).rejects.toBeInstanceOf(
        InvalidImageInputError
      );
    });
  });

  it('reads a local file path input', async () => {
    await withTempDir(async (dir) => {
      const sourcePath = path.join(dir, 'source.png');
      await fs.writeFile(sourcePath, TINY_PNG_BUFFER);
      const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gif-imageinput-test-out-'));
      try {
        const [filePath] = await resolveImageInputs([imageInputFromFilePath(sourcePath)], outDir);
        expect(filePath.endsWith('.png')).toBe(true);
        expect(await fs.readFile(filePath)).toEqual(TINY_PNG_BUFFER);
      } finally {
        await fs.rm(outDir, { recursive: true, force: true });
      }
    });
  });

  it('rejects a missing file path', async () => {
    await withTempDir(async (dir) => {
      await expect(
        resolveImageInputs([imageInputFromFilePath(path.join(dir, 'missing.png'))], dir)
      ).rejects.toBeInstanceOf(InvalidImageInputError);
    });
  });

  it('fetches a url input using the injected fetchFn', async () => {
    await withTempDir(async (dir) => {
      const fetchFn = async () =>
        new Response(TINY_PNG_BUFFER, { status: 200, headers: { 'content-type': 'image/png' } });
      const [filePath] = await resolveImageInputs([imageInputFromUrl('https://example.com/a.png')], dir, {
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      expect(await fs.readFile(filePath)).toEqual(TINY_PNG_BUFFER);
    });
  });

  it('wraps a non-ok url response in ImageFetchError', async () => {
    await withTempDir(async (dir) => {
      const fetchFn = async () => new Response('nope', { status: 404 });
      await expect(
        resolveImageInputs([imageInputFromUrl('https://example.com/missing.png')], dir, {
          fetchFn: fetchFn as unknown as typeof fetch,
        })
      ).rejects.toBeInstanceOf(ImageFetchError);
    });
  });

  it('wraps a network failure in ImageFetchError', async () => {
    await withTempDir(async (dir) => {
      const fetchFn = async () => {
        throw new Error('network down');
      };
      await expect(
        resolveImageInputs([imageInputFromUrl('https://example.com/a.png')], dir, {
          fetchFn: fetchFn as unknown as typeof fetch,
        })
      ).rejects.toBeInstanceOf(ImageFetchError);
    });
  });

  it('enforces the maxBytes guard', async () => {
    await withTempDir(async (dir) => {
      await expect(
        resolveImageInputs([imageInputFromBuffer(TINY_PNG_BUFFER)], dir, { maxBytes: 4 })
      ).rejects.toBeInstanceOf(InvalidImageInputError);
    });
  });

  it('numbers multiple frames in order', async () => {
    await withTempDir(async (dir) => {
      const paths = await resolveImageInputs(
        [imageInputFromBuffer(TINY_PNG_BUFFER), imageInputFromBuffer(TINY_PNG_BUFFER), imageInputFromBuffer(TINY_PNG_BUFFER)],
        dir
      );
      expect(paths).toEqual([
        path.join(dir, 'frame_0000.png'),
        path.join(dir, 'frame_0001.png'),
        path.join(dir, 'frame_0002.png'),
      ]);
    });
  });
});

describe('imageInputFromGeneratedImage', () => {
  it('prefers b64Json over url when both are present', () => {
    const input = imageInputFromGeneratedImage({ b64Json: 'abc', url: 'https://example.com/a.png' });
    expect(input).toEqual({ kind: 'base64', base64: 'abc', extension: undefined });
  });

  it('falls back to url when b64Json is absent', () => {
    const input = imageInputFromGeneratedImage({ url: 'https://example.com/a.png' });
    expect(input).toEqual({ kind: 'url', url: 'https://example.com/a.png' });
  });

  it('throws when neither is present', () => {
    expect(() => imageInputFromGeneratedImage({})).toThrow(TypeError);
  });
});

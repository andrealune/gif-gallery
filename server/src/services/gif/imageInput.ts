import { promises as fs } from 'fs';
import * as path from 'path';
import { ImageFetchError, InvalidImageInputError } from './errors';
import type { ImageInput } from './types';

/** Magic-byte sniffing used when an input doesn't otherwise tell us its format (e.g. a bare `url`/`base64`). */
const MAGIC_BYTES: Array<{ extension: string; signature: number[] }> = [
  { extension: 'png', signature: [0x89, 0x50, 0x4e, 0x47] },
  { extension: 'jpg', signature: [0xff, 0xd8, 0xff] },
  { extension: 'gif', signature: [0x47, 0x49, 0x46, 0x38] },
  { extension: 'webp', signature: [0x52, 0x49, 0x46, 0x46] }, // 'RIFF'; WEBP is the common case in this position
  { extension: 'bmp', signature: [0x42, 0x4d] },
];

function sniffExtension(buffer: Buffer): string {
  for (const { extension, signature } of MAGIC_BYTES) {
    if (buffer.length >= signature.length && signature.every((byte, i) => buffer[i] === byte)) {
      return extension;
    }
  }
  return 'png'; // reasonable default - ffmpeg's image decoders key off content, not the extension
}

function stripDataUrlPrefix(base64: string): string {
  const match = /^data:[^;]+;base64,(.*)$/s.exec(base64);
  return match ? match[1] : base64;
}

export interface ImageResolverOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Aborts a `url` fetch that takes longer than this, in milliseconds. Default 15000. */
  fetchTimeoutMs?: number;
  /** Max size, in bytes, accepted for a single input image - guards against runaway downloads/decodes. */
  maxBytes?: number;
}

async function fetchWithTimeout(url: string, fetchFn: typeof fetch, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function assertSize(size: number, maxBytes: number, describe: string): void {
  if (size > maxBytes) {
    throw new InvalidImageInputError(`${describe} is ${size} bytes, exceeding the ${maxBytes} byte limit.`);
  }
}

async function resolveToBuffer(frame: ImageInput, fetchFn: typeof fetch, fetchTimeoutMs: number, maxBytes: number): Promise<Buffer> {
  switch (frame.kind) {
    case 'buffer':
      assertSize(frame.buffer.length, maxBytes, 'Input image buffer');
      return frame.buffer;

    case 'base64': {
      let buffer: Buffer;
      try {
        buffer = Buffer.from(stripDataUrlPrefix(frame.base64), 'base64');
      } catch (err) {
        throw new InvalidImageInputError(`Input image base64 payload could not be decoded: ${(err as Error).message}`);
      }
      if (buffer.length === 0) {
        throw new InvalidImageInputError('Input image base64 payload decoded to zero bytes.');
      }
      assertSize(buffer.length, maxBytes, 'Input image (base64)');
      return buffer;
    }

    case 'filePath': {
      let stat;
      try {
        stat = await fs.stat(frame.filePath);
      } catch (err) {
        throw new InvalidImageInputError(`Cannot read input image at "${frame.filePath}": ${(err as Error).message}`);
      }
      assertSize(stat.size, maxBytes, `Input image at "${frame.filePath}"`);
      return fs.readFile(frame.filePath);
    }

    case 'url': {
      let res: Response;
      try {
        res = await fetchWithTimeout(frame.url, fetchFn, fetchTimeoutMs);
      } catch (err) {
        throw new ImageFetchError(`Failed to fetch input image from "${frame.url}": ${(err as Error).message}`, err);
      }
      if (!res.ok) {
        throw new ImageFetchError(`Failed to fetch input image from "${frame.url}": HTTP ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      assertSize(arrayBuffer.byteLength, maxBytes, `Input image at "${frame.url}"`);
      return Buffer.from(arrayBuffer);
    }

    default: {
      // Exhaustiveness check - a new ImageInput variant that isn't handled above is a compile error.
      const exhaustive: never = frame;
      throw new InvalidImageInputError(`Unsupported image input: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function extensionFor(frame: ImageInput, buffer: Buffer): string {
  if ((frame.kind === 'buffer' || frame.kind === 'base64') && frame.extension) {
    return frame.extension.replace(/^\./, '');
  }
  if (frame.kind === 'filePath') {
    const ext = path.extname(frame.filePath).slice(1);
    if (ext) return ext;
  }
  if (frame.kind === 'url') {
    try {
      const ext = path.extname(new URL(frame.url).pathname).slice(1);
      if (ext) return ext;
    } catch {
      // not a parseable URL shape (e.g. a relative path) - fall through to sniffing
    }
  }
  return sniffExtension(buffer);
}

/**
 * Materializes each `ImageInput` as a numbered file on disk
 * (`frame_0000.<ext>`, `frame_0001.<ext>`, ...) inside `dir`, in the given
 * order, so ffmpeg can read them as an ordered sequence. Returns the written
 * file paths, in the same order as `frames`.
 */
export async function resolveImageInputs(
  frames: ImageInput[],
  dir: string,
  options: ImageResolverOptions = {}
): Promise<string[]> {
  if (frames.length === 0) {
    throw new InvalidImageInputError('At least one input image (frame) is required.');
  }

  const fetchFn = options.fetchFn ?? fetch;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? 15000;
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024; // 25MB per frame default guard

  const paths: string[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const buffer = await resolveToBuffer(frame, fetchFn, fetchTimeoutMs, maxBytes);
    if (buffer.length === 0) {
      throw new InvalidImageInputError(`Input image at index ${index} is empty.`);
    }
    const extension = extensionFor(frame, buffer);
    const filePath = path.join(dir, `frame_${String(index).padStart(4, '0')}.${extension}`);
    await fs.writeFile(filePath, buffer);
    paths.push(filePath);
  }
  return paths;
}

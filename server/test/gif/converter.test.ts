import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GifConverter } from '../../src/services/gif/converter';
import { InvalidOptionsError } from '../../src/services/gif/errors';
import { imageInputFromBuffer, imageInputFromFilePath } from '../../src/services/gif/types';
import { ffmpegAvailable } from './ffmpegAvailable';

function gifMagicBytes(buffer: Buffer): string {
  return buffer.subarray(0, 6).toString('ascii');
}

describe('GifConverter option validation (no ffmpeg required)', () => {
  const converter = new GifConverter();

  it('rejects an empty frame list', async () => {
    await expect(converter.convert([])).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('rejects a frameDurationsMs length mismatch', async () => {
    const frame = imageInputFromBuffer(Buffer.from('not a real image'));
    await expect(converter.convert([frame], { frameDurationsMs: [100, 200] })).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it.each([
    ['width', { width: 0 }],
    ['height', { height: -1 }],
    ['fps', { fps: 0 }],
  ])('rejects a non-positive %s option', async (_name, options) => {
    const frame = imageInputFromBuffer(Buffer.from('not a real image'));
    await expect(converter.convert([frame], options)).rejects.toBeInstanceOf(InvalidOptionsError);
  });
});

describe.skipIf(!ffmpegAvailable)('GifConverter (integration, requires ffmpeg)', () => {
  let workDir: string;
  let redPng: Buffer;
  let greenPng: Buffer;
  let bluePng: Buffer;
  let converter: GifConverter;

  /** Renders a solid-color NxN PNG fixture via ffmpeg's `lavfi` color source. */
  async function makeColorFrame(color: string): Promise<Buffer> {
    const framePath = path.join(workDir, `${color}.png`);
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=16x16:d=1`, '-frames:v', '1', framePath], {
      stdio: 'ignore',
    });
    return fs.readFile(framePath);
  }

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gif-converter-test-'));
    redPng = await makeColorFrame('red');
    greenPng = await makeColorFrame('green');
    bluePng = await makeColorFrame('blue');
    converter = new GifConverter({ tmpDir: workDir, timeoutMs: 20_000 });
  }, 30_000);

  afterAll(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('assembles multiple frames into one animated GIF, in order', async () => {
    const result = await converter.convert(
      [imageInputFromBuffer(redPng), imageInputFromBuffer(greenPng), imageInputFromBuffer(bluePng)],
      { width: 32, fps: 5 }
    );

    expect(gifMagicBytes(result.gif)).toBe('GIF89a');
    expect(result.width).toBe(32);
    expect(result.frameCount).toBe(3);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  }, 20_000);

  it('applies a Ken Burns pan/zoom animation to a single still image by default', async () => {
    const result = await converter.convert([imageInputFromBuffer(redPng)], {
      width: 32,
      height: 32,
      fps: 5,
      durationMs: 600,
    });

    expect(gifMagicBytes(result.gif)).toBe('GIF89a');
    expect(result.width).toBe(32);
    expect(result.height).toBe(32);
    // ~3 frames expected (0.6s @ 5fps); allow a little slack for ffmpeg rounding.
    expect(result.frameCount).toBeGreaterThanOrEqual(2);
    expect(result.frameCount).toBeLessThanOrEqual(4);
  }, 20_000);

  it('keeps a single still frame when kenBurns is disabled', async () => {
    const result = await converter.convert([imageInputFromBuffer(redPng)], { width: 32, kenBurns: false });

    expect(gifMagicBytes(result.gif)).toBe('GIF89a');
    expect(result.frameCount).toBe(1);
  }, 20_000);

  it('supports custom per-frame durations', async () => {
    const result = await converter.convert([imageInputFromBuffer(redPng), imageInputFromBuffer(bluePng)], {
      width: 32,
      frameDurationsMs: [200, 400],
    });

    expect(gifMagicBytes(result.gif)).toBe('GIF89a');
    expect(result.frameCount).toBe(2);
  }, 20_000);

  it('convertBatch reports per-job success/failure without aborting the whole batch', async () => {
    const summary = await converter.convertBatch([
      { id: 'good', frames: [imageInputFromBuffer(redPng)], options: { width: 32 } },
      { id: 'bad', frames: [imageInputFromFilePath('/no/such/frame.png')] },
    ]);

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.results).toHaveLength(2);

    const good = summary.results[0];
    const bad = summary.results[1];
    expect(good.id).toBe('good');
    expect(good.status).toBe('fulfilled');
    if (good.status === 'fulfilled') {
      expect(gifMagicBytes(good.result.gif)).toBe('GIF89a');
    }

    expect(bad.id).toBe('bad');
    expect(bad.status).toBe('rejected');
  }, 20_000);
});

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { spawn } from 'child_process';
import { env } from '../../config/env';
import { InvalidOptionsError } from './errors';
import { runFfmpeg } from './ffmpegRunner';
import { resolveImageInputs } from './imageInput';
import type {
  BatchConversionJob,
  BatchConversionOptions,
  BatchConversionOutcome,
  BatchConversionSummary,
  GifConversionOptions,
  GifConversionResult,
  ImageInput,
} from './types';

export interface GifConverterOptions {
  ffmpegPath?: string;
  /** Defaults to `ffmpegPath`'s directory sibling `ffprobe`, or plain `ffprobe` on PATH. */
  ffprobePath?: string;
  /** Directory new temporary working directories are created under. Defaults to `os.tmpdir()`. */
  tmpDir?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultFps?: number;
  defaultLoop?: number;
  defaultDither?: string;
  defaultKenBurnsZoom?: number;
  defaultDurationMs?: number;
  /** Per-conversion ffmpeg timeout, in milliseconds. */
  timeoutMs?: number;
  /** Max size, in bytes, accepted for a single input image. */
  maxInputBytes?: number;
  /** Default `convertBatch` concurrency when a call doesn't specify one. */
  batchConcurrency?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Injectable for tests; defaults to Node's `child_process.spawn`. */
  spawnFn?: typeof spawn;
}

const DEFAULTS = {
  width: 480,
  fps: 10,
  loop: 0,
  dither: 'sierra2_4a',
  kenBurnsZoom: 1.15,
  durationMs: 3000,
  timeoutMs: 30_000,
  maxInputBytes: 25 * 1024 * 1024,
  batchConcurrency: 3,
};

/** Escapes a path for use in an ffconcat list's `file '<path>'` directive. */
function escapeConcatPath(filePath: string): string {
  return filePath.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
}

/**
 * Converts one or more still images into an animated GIF using ffmpeg:
 *
 *  - Multiple frames are assembled in order via ffmpeg's `concat` demuxer,
 *    each shown for its configured duration.
 *  - A single frame is, by default, given a short synthetic pan/zoom ("Ken
 *    Burns") animation via ffmpeg's `zoompan` filter - useful since an AI
 *    image generator (e.g. `src/services/ai`) produces one static image per
 *    call, not a ready-made animation. Pass `kenBurns: false` to keep a
 *    single still frame instead.
 *
 * Every path re-encodes through ffmpeg's two-step palette
 * (`palettegen`/`paletteuse`) filters for noticeably better color quality
 * than the GIF encoder's default fixed palette.
 *
 * See `test/gif/converter.test.ts` for example usage; `convertBatch` runs
 * several independent conversions with bounded concurrency, so one failing
 * job doesn't abort the rest.
 */
export class GifConverter {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly tmpDir: string;
  private readonly defaultWidth: number;
  private readonly defaultHeight?: number;
  private readonly defaultFps: number;
  private readonly defaultLoop: number;
  private readonly defaultDither: string;
  private readonly defaultKenBurnsZoom: number;
  private readonly defaultDurationMs: number;
  private readonly timeoutMs: number;
  private readonly maxInputBytes: number;
  private readonly batchConcurrency: number;
  private readonly fetchFn: typeof fetch;
  private readonly spawnFn?: typeof spawn;

  constructor(options: GifConverterOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.tmpDir = options.tmpDir ?? os.tmpdir();
    this.defaultWidth = options.defaultWidth ?? DEFAULTS.width;
    this.defaultHeight = options.defaultHeight;
    this.defaultFps = options.defaultFps ?? DEFAULTS.fps;
    this.defaultLoop = options.defaultLoop ?? DEFAULTS.loop;
    this.defaultDither = options.defaultDither ?? DEFAULTS.dither;
    this.defaultKenBurnsZoom = options.defaultKenBurnsZoom ?? DEFAULTS.kenBurnsZoom;
    this.defaultDurationMs = options.defaultDurationMs ?? DEFAULTS.durationMs;
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxInputBytes = options.maxInputBytes ?? DEFAULTS.maxInputBytes;
    this.batchConcurrency = options.batchConcurrency ?? DEFAULTS.batchConcurrency;
    this.fetchFn = options.fetchFn ?? fetch;
    this.spawnFn = options.spawnFn;
  }

  /** Converts a single set of frames (>= 1) into one animated GIF. */
  async convert(frames: ImageInput[], options: GifConversionOptions = {}): Promise<GifConversionResult> {
    this.validateOptions(frames, options);

    const startedAt = Date.now();
    const workDir = await fs.mkdtemp(path.join(this.tmpDir, 'gif-convert-'));
    try {
      const framePaths = await resolveImageInputs(frames, workDir, {
        fetchFn: this.fetchFn,
        maxBytes: this.maxInputBytes,
      });

      const outputPath = path.join(workDir, `${randomUUID()}.gif`);
      const timeoutMs = options.timeoutMs ?? this.timeoutMs;
      const loop = options.loop ?? this.defaultLoop;
      const dither = options.dither ?? this.defaultDither;

      if (framePaths.length === 1 && options.kenBurns !== false) {
        const fps = options.fps ?? this.defaultFps;
        const durationMs = options.durationMs ?? this.defaultDurationMs;
        const width = options.width ?? this.defaultWidth;
        const height = options.height ?? this.defaultHeight ?? width; // zoompan needs an explicit WxH; default to square
        const frameCount = Math.max(1, Math.round((durationMs / 1000) * fps));

        const intermediatePath = path.join(workDir, `${randomUUID()}.mp4`);
        await this.runFfmpegStep(
          this.buildKenBurnsPassArgs(framePaths[0], intermediatePath, {
            width,
            height,
            fps,
            frameCount,
            zoom: options.kenBurns?.zoom ?? this.defaultKenBurnsZoom,
            direction: options.kenBurns?.direction ?? 'in',
          }),
          timeoutMs
        );
        await this.runFfmpegStep(this.buildPaletteOnlyArgs(intermediatePath, outputPath, { loop, dither }), timeoutMs);
      } else {
        const width = options.width ?? this.defaultWidth;
        const height = options.height ?? this.defaultHeight ?? -1; // -1: ffmpeg preserves the source aspect ratio
        const fps = options.fps ?? this.defaultFps;
        const durations = options.frameDurationsMs ?? framePaths.map(() => 1000 / fps);
        const concatPath = path.join(workDir, 'frames.ffconcat');
        await fs.writeFile(concatPath, this.buildConcatList(framePaths, durations));

        await this.runFfmpegStep(
          this.buildStandardArgs(concatPath, outputPath, { width, height, loop, dither }),
          timeoutMs
        );
      }

      const gif = await fs.readFile(outputPath);
      const probed = await this.probeOutput(outputPath, timeoutMs);

      return {
        gif,
        frameCount: probed?.frameCount ?? framePaths.length,
        width: probed?.width ?? options.width ?? this.defaultWidth,
        height: probed?.height ?? options.height ?? this.defaultHeight ?? options.width ?? this.defaultWidth,
        elapsedMs: Date.now() - startedAt,
      };
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Runs several independent conversion jobs with bounded concurrency. A
   * failing job is reported in its own outcome (`status: 'rejected'`)
   * without affecting the others, so a caller processing e.g. a whole batch
   * of freshly-generated images doesn't lose the rest of the batch to one
   * bad input.
   */
  async convertBatch<TId = string>(
    jobs: BatchConversionJob<TId>[],
    batchOptions: BatchConversionOptions<TId> = {}
  ): Promise<BatchConversionSummary<TId>> {
    const concurrency = Math.max(1, Math.min(batchOptions.concurrency ?? this.batchConcurrency, jobs.length || 1));
    const results: BatchConversionOutcome<TId>[] = new Array(jobs.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const i = nextIndex;
        nextIndex += 1;
        if (i >= jobs.length) return;
        const job = jobs[i];
        let outcome: BatchConversionOutcome<TId>;
        try {
          const result = await this.convert(job.frames, job.options);
          outcome = { id: job.id, status: 'fulfilled', result };
        } catch (error) {
          outcome = { id: job.id, status: 'rejected', error };
        }
        results[i] = outcome;
        batchOptions.onJobSettled?.(outcome);
      }
    };

    const workerCount = Math.min(concurrency, jobs.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    return { results, succeeded, failed: results.length - succeeded };
  }

  private validateOptions(frames: ImageInput[], options: GifConversionOptions): void {
    if (frames.length === 0) {
      throw new InvalidOptionsError('At least one input image (frame) is required.');
    }
    if (options.frameDurationsMs && options.frameDurationsMs.length !== frames.length) {
      throw new InvalidOptionsError(
        `frameDurationsMs has ${options.frameDurationsMs.length} entries but ${frames.length} frames were given.`
      );
    }
    if (options.width !== undefined && options.width <= 0) {
      throw new InvalidOptionsError('width must be a positive number.');
    }
    if (options.height !== undefined && options.height <= 0) {
      throw new InvalidOptionsError('height must be a positive number.');
    }
    if (options.fps !== undefined && options.fps <= 0) {
      throw new InvalidOptionsError('fps must be a positive number.');
    }
  }

  private buildConcatList(framePaths: string[], durationsMs: number[]): string {
    const lines = ['ffconcat version 1.0'];
    framePaths.forEach((filePath, i) => {
      lines.push(`file '${escapeConcatPath(filePath)}'`);
      lines.push(`duration ${(durationsMs[i] / 1000).toFixed(3)}`);
    });
    return lines.join('\n') + '\n';
  }

  private buildStandardArgs(
    concatPath: string,
    outputPath: string,
    opts: { width: number; height: number; loop: number; dither: string }
  ): string[] {
    const vf =
      `scale=${opts.width}:${opts.height}:flags=lanczos,` +
      `split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=${opts.dither}`;
    return ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-vf', vf, '-loop', String(opts.loop), outputPath];
  }

  private buildKenBurnsPassArgs(
    framePath: string,
    intermediatePath: string,
    opts: { width: number; height: number; fps: number; frameCount: number; zoom: number; direction: 'in' | 'out' }
  ): string[] {
    const zoomStep = (opts.zoom - 1) / Math.max(opts.frameCount - 1, 1);
    const zExpr =
      opts.direction === 'in'
        ? `min(zoom+${zoomStep.toFixed(6)},${opts.zoom})`
        : `if(eq(on,1),${opts.zoom},max(zoom-${zoomStep.toFixed(6)},1.0))`;
    const filter = `zoompan=z='${zExpr}':d=${opts.frameCount}:s=${opts.width}x${opts.height}:fps=${opts.fps}`;
    return [
      '-y',
      '-loop',
      '1',
      '-framerate',
      String(opts.fps),
      '-i',
      framePath,
      '-filter_complex',
      filter,
      '-frames:v',
      String(opts.frameCount),
      '-pix_fmt',
      'yuv420p',
      intermediatePath,
    ];
  }

  private buildPaletteOnlyArgs(inputPath: string, outputPath: string, opts: { loop: number; dither: string }): string[] {
    const vf = `split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=${opts.dither}`;
    return ['-y', '-i', inputPath, '-vf', vf, '-loop', String(opts.loop), outputPath];
  }

  private async runFfmpegStep(args: string[], timeoutMs: number): Promise<void> {
    await runFfmpeg({ ffmpegPath: this.ffmpegPath, args, timeoutMs, spawnFn: this.spawnFn });
  }

  /**
   * Reads the actual width/height/frame count back from the encoded GIF via
   * ffprobe, so the result reflects what was really written rather than what
   * was requested (e.g. when `height` was left to ffmpeg to auto-compute).
   * Best-effort: returns `null` (never throws) if ffprobe is unavailable or
   * its output can't be parsed - the conversion itself already succeeded by
   * the time this runs, so a probe failure shouldn't fail the whole call.
   */
  private async probeOutput(
    gifPath: string,
    timeoutMs: number
  ): Promise<{ width: number; height: number; frameCount: number } | null> {
    try {
      const { stdout } = await runFfmpeg({
        ffmpegPath: this.ffprobePath,
        args: [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-count_frames',
          '-show_entries',
          'stream=width,height,nb_read_frames',
          '-of',
          'csv=p=0',
          gifPath,
        ],
        timeoutMs,
        spawnFn: this.spawnFn,
      });
      const [width, height, frameCount] = stdout.trim().split(',').map(Number);
      if ([width, height, frameCount].some((n) => !Number.isFinite(n) || n <= 0)) {
        return null;
      }
      return { width, height, frameCount };
    } catch {
      return null;
    }
  }
}

/** Builds the process-wide converter from environment configuration (see `src/config/env.ts`). */
export function createGifConverterFromEnv(): GifConverter {
  return new GifConverter({
    ffmpegPath: env.gif.ffmpegPath,
    ffprobePath: env.gif.ffprobePath,
    tmpDir: env.gif.tmpDir || undefined,
    defaultWidth: env.gif.defaultWidth,
    defaultHeight: env.gif.defaultHeight,
    defaultFps: env.gif.defaultFps,
    defaultLoop: env.gif.defaultLoop,
    defaultDither: env.gif.defaultDither,
    defaultKenBurnsZoom: env.gif.kenBurnsZoom,
    defaultDurationMs: env.gif.kenBurnsDurationMs,
    timeoutMs: env.gif.conversionTimeoutMs,
    maxInputBytes: env.gif.maxInputBytes,
    batchConcurrency: env.gif.batchConcurrency,
  });
}

/**
 * Shared singleton for the whole process, mirroring the pattern used by the
 * database pool (`src/db/pool.ts`) and the AI image client
 * (`src/services/ai`). Feature code (e.g. the batch generation scheduler,
 * L42-424) should import this rather than constructing its own converter.
 */
export const gifConverter = createGifConverterFromEnv();

import { spawn } from 'child_process';
import { FfmpegExecutionError, FfmpegNotFoundError, GifConversionTimeoutError } from './errors';

export interface RunFfmpegOptions {
  ffmpegPath: string;
  args: string[];
  timeoutMs: number;
  /** Injectable for tests; defaults to Node's `child_process.spawn`. */
  spawnFn?: typeof spawn;
}

const OUTPUT_TAIL_LIMIT = 32_000;

function boundedAppend(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8');
  return next.length > OUTPUT_TAIL_LIMIT ? next.slice(-OUTPUT_TAIL_LIMIT) : next;
}

/**
 * Runs ffmpeg (or ffprobe) with the given arguments to completion, rejecting
 * with a typed error on a missing binary, non-zero exit, or timeout.
 * stdin is ignored; stdout/stderr are captured (bounded to the last ~32KB
 * each, since ffmpeg's progress output can be chatty) and returned for the
 * caller to parse (ffprobe) or use in diagnostics (ffmpeg).
 */
export async function runFfmpeg(options: RunFfmpegOptions): Promise<{ stdout: string; stderr: string }> {
  const spawnFn = options.spawnFn ?? spawn;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child: ReturnType<typeof spawn>;

    try {
      child = spawnFn(options.ffmpegPath, options.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      reject(code === 'ENOENT' ? new FfmpegNotFoundError(options.ffmpegPath) : err);
      return;
    }

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new GifConversionTimeoutError(options.timeoutMs));
    }, options.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk);
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (err.code === 'ENOENT') {
        reject(new FfmpegNotFoundError(options.ffmpegPath));
      } else {
        reject(new FfmpegExecutionError(`Failed to start ffmpeg: ${err.message}`, null, stderr));
      }
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new FfmpegExecutionError(`ffmpeg exited with code ${code}`, code, stderr));
      }
    });
  });
}

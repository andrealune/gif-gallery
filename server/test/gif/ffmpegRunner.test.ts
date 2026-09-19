import { EventEmitter } from 'events';
import type { spawn } from 'child_process';
import { describe, expect, it } from 'vitest';
import { FfmpegExecutionError, FfmpegNotFoundError, GifConversionTimeoutError } from '../../src/services/gif/errors';
import { runFfmpeg } from '../../src/services/gif/ffmpegRunner';

/** Minimal fake `ChildProcess` good enough for `runFfmpeg`'s needs. */
class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

describe('runFfmpeg', () => {
  it('resolves with captured stdout/stderr on a clean exit', async () => {
    const child = new FakeChildProcess();
    const spawnFn = (() => child) as unknown as typeof spawn;

    const promise = runFfmpeg({ ffmpegPath: 'ffmpeg', args: ['-version'], timeoutMs: 5000, spawnFn });
    child.stdout.emit('data', Buffer.from('hello '));
    child.stdout.emit('data', Buffer.from('world'));
    child.stderr.emit('data', Buffer.from('some progress'));
    child.emit('close', 0);

    await expect(promise).resolves.toEqual({ stdout: 'hello world', stderr: 'some progress' });
  });

  it('rejects with FfmpegExecutionError (carrying exit code + stderr) on a non-zero exit', async () => {
    const child = new FakeChildProcess();
    const spawnFn = (() => child) as unknown as typeof spawn;

    const promise = runFfmpeg({ ffmpegPath: 'ffmpeg', args: [], timeoutMs: 5000, spawnFn });
    child.stderr.emit('data', Buffer.from('invalid argument'));
    child.emit('close', 1);

    await expect(promise).rejects.toBeInstanceOf(FfmpegExecutionError);
    try {
      await promise;
    } catch (err) {
      const execErr = err as FfmpegExecutionError;
      expect(execErr.exitCode).toBe(1);
      expect(execErr.stderr).toContain('invalid argument');
    }
  });

  it('rejects with FfmpegNotFoundError when the binary is missing (spawn "error" event)', async () => {
    const child = new FakeChildProcess();
    const spawnFn = (() => child) as unknown as typeof spawn;

    const promise = runFfmpeg({ ffmpegPath: '/no/such/ffmpeg', args: [], timeoutMs: 5000, spawnFn });
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    child.emit('error', enoent);

    await expect(promise).rejects.toBeInstanceOf(FfmpegNotFoundError);
  });

  it('rejects with FfmpegNotFoundError when spawn() itself throws ENOENT synchronously', async () => {
    const spawnFn = (() => {
      throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    }) as unknown as typeof spawn;

    await expect(runFfmpeg({ ffmpegPath: '/no/such/ffmpeg', args: [], timeoutMs: 5000, spawnFn })).rejects.toBeInstanceOf(
      FfmpegNotFoundError
    );
  });

  it('kills the process and rejects with GifConversionTimeoutError when it runs too long', async () => {
    const child = new FakeChildProcess();
    const spawnFn = (() => child) as unknown as typeof spawn;

    const promise = runFfmpeg({ ffmpegPath: 'ffmpeg', args: [], timeoutMs: 10, spawnFn });

    await expect(promise).rejects.toBeInstanceOf(GifConversionTimeoutError);
    expect(child.killed).toBe(true);
  });
});

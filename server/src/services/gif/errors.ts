/**
 * Error hierarchy for the image-to-GIF conversion pipeline.
 *
 * Callers (e.g. the batch generation scheduler, L42-424) can `instanceof`
 * check these to decide how to react - e.g. retry `FfmpegExecutionError`/
 * `GifConversionTimeoutError` for one job without failing an entire batch,
 * but treat `InvalidImageInputError`/`InvalidOptionsError` as a non-retryable
 * bug in the caller's input.
 */
export class GifConversionError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'GifConversionError';
    this.cause = cause;
  }
}

/** A frame's `ImageInput` couldn't be read/decoded (missing file, bad base64, unsupported shape, ...). */
export class InvalidImageInputError extends GifConversionError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageInputError';
  }
}

/** `GifConversionOptions` were internally inconsistent (e.g. mismatched `frameDurationsMs` length). */
export class InvalidOptionsError extends GifConversionError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOptionsError';
  }
}

/** Fetching a frame supplied as `{ kind: 'url' }` failed. */
export class ImageFetchError extends GifConversionError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'ImageFetchError';
  }
}

/** The configured ffmpeg executable could not be found/started. */
export class FfmpegNotFoundError extends GifConversionError {
  readonly ffmpegPath: string;

  constructor(ffmpegPath: string) {
    super(`ffmpeg executable not found (looked for "${ffmpegPath}"). Install ffmpeg or set FFMPEG_PATH.`);
    this.name = 'FfmpegNotFoundError';
    this.ffmpegPath = ffmpegPath;
  }
}

/** ffmpeg started but exited with a non-zero status. */
export class FfmpegExecutionError extends GifConversionError {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message);
    this.name = 'FfmpegExecutionError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** ffmpeg did not finish within the configured timeout and was killed. */
export class GifConversionTimeoutError extends GifConversionError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`GIF conversion did not complete within ${timeoutMs}ms`);
    this.name = 'GifConversionTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Shared types for the image-to-GIF conversion pipeline (`src/services/gif`).
 */

/**
 * A single source image, or one frame of a multi-frame animation. Exactly one
 * of the four shapes below is used to locate/decode the underlying bytes -
 * callers pick whichever is convenient (e.g. a `url`/`b64Json` straight off
 * `GenerateImageResult` from `src/services/ai`, a `Buffer` already in memory,
 * or a `filePath` already on disk).
 */
export type ImageInput =
  | { kind: 'filePath'; filePath: string }
  | { kind: 'buffer'; buffer: Buffer; extension?: string }
  | { kind: 'base64'; base64: string; extension?: string }
  | { kind: 'url'; url: string };

export function imageInputFromFilePath(filePath: string): ImageInput {
  return { kind: 'filePath', filePath };
}

export function imageInputFromBuffer(buffer: Buffer, extension?: string): ImageInput {
  return { kind: 'buffer', buffer, extension };
}

/** `base64` may be a bare base64 string or a `data:image/...;base64,` URL. */
export function imageInputFromBase64(base64: string, extension?: string): ImageInput {
  return { kind: 'base64', base64, extension };
}

export function imageInputFromUrl(url: string): ImageInput {
  return { kind: 'url', url };
}

/**
 * Bridges a generated image (the shape returned by
 * `src/services/ai`'s `GeneratedImage`, structurally - no runtime dependency
 * on that module) straight into an `ImageInput`, preferring the base64 payload
 * when both are present since it avoids a redundant network round-trip.
 */
export function imageInputFromGeneratedImage(image: { url?: string; b64Json?: string }): ImageInput {
  if (image.b64Json) {
    return imageInputFromBase64(image.b64Json);
  }
  if (image.url) {
    return imageInputFromUrl(image.url);
  }
  throw new TypeError('Generated image has neither `url` nor `b64Json`.');
}

/** Ken Burns (pan/zoom) animation applied when a single still image is converted. */
export interface KenBurnsOptions {
  /** Zoom factor reached by the end of the animation (1 = no zoom). Default 1.15. */
  zoom?: number;
  /** Whether the animation zooms in (start wide, end tight) or out. Default 'in'. */
  direction?: 'in' | 'out';
}

export interface GifConversionOptions {
  /** Output width in pixels. Default from the converter's configuration (480). */
  width?: number;
  /**
   * Output height in pixels. When converting multiple frames (or a single
   * frame with `kenBurns: false`), omitting this preserves the source aspect
   * ratio. The Ken Burns (single-image) path requires an explicit
   * width/height pair (ffmpeg's `zoompan` filter has no "auto" axis), so it
   * falls back to a square frame (`height = width`) when unset.
   */
  height?: number;
  /** Frames per second for uniformly-spaced frames. Ignored when `frameDurationsMs` is given. Default 10. */
  fps?: number;
  /** Per-frame duration overrides, in milliseconds. Must have the same length as the frame list. */
  frameDurationsMs?: number[];
  /** GIF loop count: `0` = loop forever (default), `-1` = play once, `N > 0` = loop `N` extra times. */
  loop?: number;
  /**
   * When converting a *single* still image, synthesize a short pan/zoom
   * ("Ken Burns") animation instead of emitting a static one-frame GIF. Pass
   * `false` to keep a single still frame. Ignored (no-op) when more than one
   * frame is supplied - those are assembled as-is. Defaults to enabled.
   */
  kenBurns?: KenBurnsOptions | false;
  /** Duration of a single-image Ken Burns animation, in milliseconds. Default 3000. */
  durationMs?: number;
  /** Dithering algorithm passed to ffmpeg's `paletteuse` filter. Default 'sierra2_4a'. */
  dither?: string;
  /** Overrides the converter's default ffmpeg timeout for this conversion only. */
  timeoutMs?: number;
}

export interface GifConversionResult {
  /** The encoded animated GIF. */
  gif: Buffer;
  /** Number of frames in the encoded GIF. */
  frameCount: number;
  width: number;
  height: number;
  /** Wall-clock time the conversion took, in milliseconds. */
  elapsedMs: number;
}

export interface BatchConversionJob<TId = string> {
  id: TId;
  frames: ImageInput[];
  options?: GifConversionOptions;
}

export interface BatchConversionSuccess<TId = string> {
  id: TId;
  status: 'fulfilled';
  result: GifConversionResult;
}

export interface BatchConversionFailure<TId = string> {
  id: TId;
  status: 'rejected';
  error: unknown;
}

export type BatchConversionOutcome<TId = string> = BatchConversionSuccess<TId> | BatchConversionFailure<TId>;

export interface BatchConversionOptions<TId = string> {
  /** Max number of conversions to run at once. Defaults to the converter's configured concurrency. */
  concurrency?: number;
  /** Called synchronously as soon as each job settles (success or failure) - useful for progress reporting. */
  onJobSettled?: (outcome: BatchConversionOutcome<TId>) => void;
}

export interface BatchConversionSummary<TId = string> {
  /** One entry per input job, in the same order the jobs were given. */
  results: BatchConversionOutcome<TId>[];
  succeeded: number;
  failed: number;
}

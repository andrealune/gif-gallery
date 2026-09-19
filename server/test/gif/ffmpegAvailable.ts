import { spawnSync } from 'child_process';

/**
 * Whether the `ffmpeg`/`ffprobe` binaries the pipeline shells out to are
 * actually available in this environment. Integration-style tests that
 * invoke the real converter use this to skip themselves (with a console
 * warning) instead of failing on machines/CI images that don't have ffmpeg
 * installed - see the README's "Getting started" section.
 */
export function isFfmpegAvailable(): boolean {
  try {
    const ffmpeg = spawnSync('ffmpeg', ['-version']);
    const ffprobe = spawnSync('ffprobe', ['-version']);
    return ffmpeg.status === 0 && ffprobe.status === 0;
  } catch {
    return false;
  }
}

export const ffmpegAvailable = isFfmpegAvailable();

if (!ffmpegAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    'ffmpeg/ffprobe not found on PATH - skipping GIF conversion integration tests. Install ffmpeg to run them.'
  );
}

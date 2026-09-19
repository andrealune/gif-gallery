export {
  GifConverter,
  createGifConverterFromEnv,
  gifConverter,
  type GifConverterOptions,
} from './converter';

export {
  imageInputFromBase64,
  imageInputFromBuffer,
  imageInputFromFilePath,
  imageInputFromGeneratedImage,
  imageInputFromUrl,
  type BatchConversionFailure,
  type BatchConversionJob,
  type BatchConversionOptions,
  type BatchConversionOutcome,
  type BatchConversionSuccess,
  type BatchConversionSummary,
  type GifConversionOptions,
  type GifConversionResult,
  type ImageInput,
  type KenBurnsOptions,
} from './types';

export { resolveImageInputs, type ImageResolverOptions } from './imageInput';

export {
  FfmpegExecutionError,
  FfmpegNotFoundError,
  GifConversionError,
  GifConversionTimeoutError,
  ImageFetchError,
  InvalidImageInputError,
  InvalidOptionsError,
} from './errors';

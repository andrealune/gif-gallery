import { env } from '../config/env';
import { localStorage } from './localStorage';
import { s3Storage } from './s3Storage';
import type { StorageClient } from './types';

function selectStorage(): StorageClient {
  switch (env.storage.provider) {
    case 's3':
      return s3Storage;
    case 'local':
      return localStorage;
    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${env.storage.provider}". Expected "local" or "s3".`);
  }
}

/**
 * The storage client selected via `STORAGE_PROVIDER`. Import this rather
 * than a specific driver so GIF generation/upload/serving code stays
 * portable between local development (filesystem) and the S3 + CloudFront
 * setup used in staging/production (see infra/terraform/storage).
 */
export const storage: StorageClient = selectStorage();

export type { PutObjectInput, PutObjectResult, StorageClient } from './types';

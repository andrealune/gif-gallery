import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import type { PutObjectInput, PutObjectResult, StorageClient } from './types';

const bucket = env.storage.s3Bucket;

const client = new S3Client({
  region: env.storage.s3Region,
  endpoint: env.storage.s3Endpoint || undefined,
  forcePathStyle: env.storage.s3ForcePathStyle,
  // Falls back to the default AWS credential provider chain (an ECS task
  // role / EC2 instance profile / SDK default chain) when explicit keys are
  // not configured. Prefer that over long-lived access keys once the app
  // runs on AWS compute; see infra/terraform/storage/README.md.
  credentials: env.storage.s3AccessKeyId
    ? { accessKeyId: env.storage.s3AccessKeyId, secretAccessKey: env.storage.s3SecretAccessKey }
    : undefined,
});

function buildPublicUrl(key: string): string {
  if (env.storage.cdnBaseUrl) {
    return `${env.storage.cdnBaseUrl.replace(/\/$/, '')}/${key}`;
  }
  // Fallback direct (virtual-hosted-style) S3 URL. The bucket provisioned by
  // infra/terraform/storage blocks all public access, so this only works if
  // the caller separately has access (e.g. via getSignedUrl); configure
  // CDN_BASE_URL (the CloudFront domain) for normal operation.
  return `https://${bucket}.s3.${env.storage.s3Region}.amazonaws.com/${key}`;
}

/**
 * S3-compatible storage driver (`STORAGE_PROVIDER=s3`). Works against AWS S3
 * as well as S3-compatible services (e.g. GCS via its S3 interoperability
 * mode, MinIO, R2) by setting `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE`. See
 * infra/terraform/storage for the bucket/CDN/IAM this is meant to pair with.
 */
export const s3Storage: StorageClient = {
  async putObject({ key, body, contentType, cacheControl }: PutObjectInput): Promise<PutObjectResult> {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl ?? 'public, max-age=31536000, immutable',
      })
    );
    return { key, url: buildPublicUrl(key) };
  },

  async deleteObject(key: string): Promise<void> {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },

  getPublicUrl(key: string): string {
    return buildPublicUrl(key);
  },

  async getSignedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return presign(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  },

  async checkHealth(): Promise<boolean> {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    } catch {
      return false;
    }
  },
};

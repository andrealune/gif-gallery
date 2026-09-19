import dotenv from 'dotenv';
import path from 'path';

// Load .env file (no-op in production if the file is absent; real values
// are expected to come from the process environment in that case).
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function requiredInProduction(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? '';
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const port = toInt(process.env.PORT, 3001);

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
  isTest: optional('NODE_ENV', 'development') === 'test',
  port,
  corsOrigin: optional('CORS_ORIGIN', '*'),

  db: {
    connectionString: optional('DATABASE_URL'),
    host: optional('DB_HOST', 'localhost'),
    port: toInt(process.env.DB_PORT, 5432),
    database: optional('DB_NAME', 'gif_gallery'),
    user: optional('DB_USER', 'postgres'),
    password: optional('DB_PASSWORD', ''),
    ssl: toBool(process.env.DB_SSL, false),
    poolMax: toInt(process.env.DB_POOL_MAX, 10),
    idleTimeoutMillis: toInt(process.env.DB_IDLE_TIMEOUT_MS, 30000),
    connectionTimeoutMillis: toInt(process.env.DB_CONNECTION_TIMEOUT_MS, 5000),
  },

  ai: {
    // Consumed by the AI generation client set up in a later task (L42-421).
    openaiApiKey: requiredInProduction('OPENAI_API_KEY'),
  },

  storage: {
    // "local" (default, filesystem) or "s3" (AWS S3 or an S3-compatible
    // service such as GCS's interop endpoint, MinIO, R2). See
    // server/src/storage/ and infra/terraform/storage for the S3 + CDN setup.
    provider: optional('STORAGE_PROVIDER', 'local'),

    // -- local driver --
    localDir: optional('STORAGE_LOCAL_DIR', './storage'),
    publicBaseUrl: optional('STORAGE_PUBLIC_BASE_URL', `http://localhost:${port}/storage`),

    // -- s3 driver --
    s3Bucket: optional('S3_BUCKET'),
    s3Region: optional('S3_REGION', 'us-east-1'),
    s3AccessKeyId: optional('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: optional('S3_SECRET_ACCESS_KEY'),
    // Optional: only set for S3-compatible services (MinIO, GCS interop, R2).
    s3Endpoint: optional('S3_ENDPOINT'),
    s3ForcePathStyle: toBool(process.env.S3_FORCE_PATH_STYLE, false),

    // Public CDN domain (e.g. the CloudFront distribution from
    // infra/terraform/storage) prefixed to object keys to build public
    // GIF URLs. Falls back to a direct S3 URL when unset.
    cdnBaseUrl: optional('CDN_BASE_URL'),
  },
};

export type Env = typeof env;

if (env.isProduction && env.storage.provider === 's3' && !env.storage.s3Bucket) {
  throw new Error('S3_BUCKET is required in production when STORAGE_PROVIDER=s3');
}

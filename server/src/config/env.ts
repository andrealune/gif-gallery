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

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',
  isTest: optional('NODE_ENV', 'development') === 'test',
  port: toInt(process.env.PORT, 3001),
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
    // Consumed by the file storage setup in a later task (L42-425).
    provider: optional('STORAGE_PROVIDER', 'local'),
    localDir: optional('STORAGE_LOCAL_DIR', './storage'),
    s3Bucket: optional('S3_BUCKET'),
    s3Region: optional('S3_REGION'),
    s3AccessKeyId: optional('S3_ACCESS_KEY_ID'),
    s3SecretAccessKey: optional('S3_SECRET_ACCESS_KEY'),
  },
};

export type Env = typeof env;

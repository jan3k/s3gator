import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_BASE_URL: z.string().url().default("http://localhost:4000"),
  DATABASE_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().default("s3gator_sid"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  APP_ENCRYPTION_KEY: z.string().min(32),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
  LOGIN_WINDOW_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  REDIS_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .default(true),
  REDIS_PREFIX: z.string().default("s3gator"),
  CORRELATION_HEADER_NAME: z.string().default("x-request-id"),
  OTEL_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .default(false),
  OTEL_SERVICE_NAME: z.string().default("s3gator-api"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  JOB_WORKER_INLINE: z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .default(false),
  JOB_WORKER_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2000),
  JOB_LOCK_TTL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  JOB_RETRY_MAX_ATTEMPTS_BUCKET_SYNC: z.coerce.number().int().min(1).max(20).default(5),
  JOB_RETRY_MAX_ATTEMPTS_UPLOAD_CLEANUP: z.coerce.number().int().min(1).max(20).default(3),
  JOB_RETRY_MAX_ATTEMPTS_RETENTION_CLEANUP: z.coerce.number().int().min(1).max(20).default(3),
  JOB_RETRY_BACKOFF_SECONDS_BUCKET_SYNC: z.coerce.number().int().min(1).max(3600).default(15),
  JOB_RETRY_BACKOFF_SECONDS_UPLOAD_CLEANUP: z.coerce.number().int().min(1).max(3600).default(30),
  JOB_RETRY_BACKOFF_SECONDS_RETENTION_CLEANUP: z.coerce.number().int().min(1).max(3600).default(60),
  JOB_RETRY_MAX_BACKOFF_SECONDS: z.coerce.number().int().min(5).max(86_400).default(900),
  UPLOAD_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  UPLOAD_PART_SIZE_BYTES: z.coerce.number().int().min(5 * 1024 * 1024).max(128 * 1024 * 1024).default(10 * 1024 * 1024),
  UPLOAD_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  RETENTION_JOB_EVENTS_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  RETENTION_FAILED_JOB_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  RETENTION_TERMINAL_JOB_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  RETENTION_AUDIT_LOG_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  RETENTION_SECURITY_AUDIT_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
  RETENTION_UPLOAD_SESSION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  RETENTION_ARCHIVE_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .default(false),
  RETENTION_ARCHIVE_BATCH_SIZE: z.coerce.number().int().min(10).max(5000).default(500),
  MAINTENANCE_SCHEDULER_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .default(false),
  MAINTENANCE_SCHEDULER_TICK_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  MAINTENANCE_SCHEDULER_LOCK_TTL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  MAINTENANCE_RETENTION_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(10_080).default(360),
  MAINTENANCE_UPLOAD_CLEANUP_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(10_080).default(30),
  MAINTENANCE_BUCKET_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(10_080).default(0),
  GARAGE_ENDPOINT: z.string().url().optional(),
  GARAGE_REGION: z.string().default("garage"),
  GARAGE_FORCE_PATH_STYLE: z
    .union([z.boolean(), z.string()])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .default(true),
  GARAGE_ACCESS_KEY_ID: z.string().optional(),
  GARAGE_SECRET_ACCESS_KEY: z.string().optional(),
  GARAGE_ADMIN_API_URL: z.string().url().optional(),
  GARAGE_ADMIN_TOKEN: z.string().optional(),
  DEFAULT_SUPER_ADMIN_USERNAME: z.string().default("admin"),
  DEFAULT_SUPER_ADMIN_PASSWORD: z.string().default("change-me-now-please"),
  DEFAULT_SUPER_ADMIN_EMAIL: z.string().email().default("admin@example.local")
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(env: NodeJS.ProcessEnv): AppEnv {
  return envSchema.parse(env);
}

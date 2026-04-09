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

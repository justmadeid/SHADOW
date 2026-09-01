import { z } from "zod";

const platformApiSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_VERSION: z.string().default("0.0.0-dev"),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default("http://127.0.0.1:4318"),
});

export type PlatformApiConfig = z.infer<typeof platformApiSchema>;

export function loadPlatformApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlatformApiConfig {
  return platformApiSchema.parse(env);
}

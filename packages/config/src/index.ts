import { z } from "zod";

const oidcSigningAlgorithm = z.enum([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
]);

const commaSeparated = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const platformApiSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_VERSION: z.string().default("0.0.0-dev"),
    APP_PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.string().default("info"),
    DATABASE_URL: z.string().min(1),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default("http://127.0.0.1:4318"),
    OIDC_ISSUER: z.string().url(),
    OIDC_AUDIENCE: z.string().min(1),
    OIDC_JWKS_URI: z.string().url(),
    OIDC_ALLOWED_ALGORITHMS: z
      .string()
      .default("RS256")
      .transform(commaSeparated)
      .pipe(z.array(oidcSigningAlgorithm).min(1)),
    OIDC_SERVICE_CLIENT_IDS: z.string().default("").transform(commaSeparated),
  })
  .superRefine((config, context) => {
    if (config.APP_ENV !== "production") {
      return;
    }

    for (const field of ["OIDC_ISSUER", "OIDC_JWKS_URI"] as const) {
      if (new URL(config[field]).protocol !== "https:") {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must use HTTPS in production.`,
        });
      }
    }
  });

export type PlatformApiConfig = z.infer<typeof platformApiSchema>;

export function loadPlatformApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlatformApiConfig {
  return platformApiSchema.parse(env);
}

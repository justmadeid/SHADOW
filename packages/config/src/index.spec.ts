import { describe, expect, it } from "vitest";

import { loadPlatformApiConfig } from "./index.js";

const validEnvironment = {
  DATABASE_URL: "postgresql://user:password@127.0.0.1:5432/intelligence",
  REDIS_URL: "redis://127.0.0.1:6379",
  OIDC_ISSUER: "https://identity.example.test",
  OIDC_AUDIENCE: "intelligence-platform-api",
  OIDC_JWKS_URI: "https://identity.example.test/.well-known/jwks.json",
  OIDC_ALLOWED_ALGORITHMS: "RS256,ES256",
  OIDC_SERVICE_CLIENT_IDS: "connector-worker, indexing-worker",
  IDENTIFIER_ENCRYPTION_KEY_ID: "test-encryption-v1",
  IDENTIFIER_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 1).toString("base64"),
  IDENTIFIER_FINGERPRINT_KEY_ID: "test-fingerprint-v1",
  IDENTIFIER_FINGERPRINT_KEY_BASE64: Buffer.alloc(32, 2).toString("base64"),
};

describe("platform API authentication configuration", () => {
  it("parses explicit OIDC trust and service identity values", () => {
    const config = loadPlatformApiConfig(validEnvironment);

    expect(config.OIDC_ALLOWED_ALGORITHMS).toEqual(["RS256", "ES256"]);
    expect(config.OIDC_SERVICE_CLIENT_IDS).toEqual([
      "connector-worker",
      "indexing-worker",
    ]);
  });

  it("rejects startup without an explicit OIDC trust configuration", () => {
    expect(() =>
      loadPlatformApiConfig({ DATABASE_URL: validEnvironment.DATABASE_URL }),
    ).toThrow();
  });

  it("rejects symmetric token algorithms", () => {
    expect(() =>
      loadPlatformApiConfig({
        ...validEnvironment,
        OIDC_ALLOWED_ALGORITHMS: "HS256",
      }),
    ).toThrow();
  });

  it("requires HTTPS OIDC endpoints in production", () => {
    expect(() =>
      loadPlatformApiConfig({
        ...validEnvironment,
        APP_ENV: "production",
        OIDC_JWKS_URI: "http://identity.internal.test/jwks.json",
      }),
    ).toThrow();
  });

  it("requires distinct 256-bit identifier protection keys", () => {
    expect(() =>
      loadPlatformApiConfig({
        ...validEnvironment,
        IDENTIFIER_FINGERPRINT_KEY_BASE64:
          validEnvironment.IDENTIFIER_ENCRYPTION_KEY_BASE64,
      }),
    ).toThrow();
    expect(() =>
      loadPlatformApiConfig({
        ...validEnvironment,
        IDENTIFIER_ENCRYPTION_KEY_BASE64: "not-a-key",
      }),
    ).toThrow();
  });
});

import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { AccessTokenVerificationError } from "./access-token.js";
import { createOidcAccessTokenVerifier } from "./oidc-access-token-verifier.js";

const issuer = "https://identity.example.test";
const audience = "intelligence-platform-api";
const keyId = "test-key";

let privateKey: CryptoKey;
let verifier: ReturnType<typeof createOidcAccessTokenVerifier>;

async function signToken(
  claims: Record<string, unknown> = {},
  overrides: { issuer?: string; audience?: string; expiresAt?: string } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: keyId, typ: "at+jwt" })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setSubject("subject-123")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresAt ?? "5m")
    .sign(privateKey);
}

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);

  const keyResolver = createLocalJWKSet({
    keys: [{ ...publicJwk, alg: "RS256", kid: keyId, use: "sig" }],
  });

  verifier = createOidcAccessTokenVerifier(
    {
      issuer,
      audience,
      jwksUri: `${issuer}/jwks.json`,
      algorithms: ["RS256"],
      serviceClientIds: ["connector-worker"],
      clockToleranceSeconds: 0,
    },
    { keyResolver },
  );
});

describe("OIDC access-token verifier", () => {
  it("maps a valid OIDC subject to a user principal", async () => {
    await expect(verifier.verify(await signToken())).resolves.toEqual({
      kind: "USER",
      subject: "subject-123",
      userId: "subject-123",
      issuer,
    });
  });

  it("maps only allowlisted OIDC clients to service principals", async () => {
    await expect(
      verifier.verify(await signToken({ client_id: "connector-worker" })),
    ).resolves.toEqual({
      kind: "SERVICE",
      subject: "subject-123",
      serviceId: "connector-worker",
      clientId: "connector-worker",
      issuer,
    });

    await expect(
      verifier.verify(await signToken({ client_id: "untrusted-client" })),
    ).resolves.toMatchObject({ kind: "USER", userId: "subject-123" });
  });

  it.each([
    ["wrong issuer", { issuer: "https://other-issuer.example.test" }],
    ["wrong audience", { audience: "another-api" }],
    ["expired token", { expiresAt: "0s" }],
  ])("rejects a token with %s", async (_label, overrides) => {
    await expect(verifier.verify(await signToken({}, overrides))).rejects.toBeInstanceOf(
      AccessTokenVerificationError,
    );
  });

  it("rejects a token signed by an unknown key", async () => {
    const unknownKey = await generateKeyPair("RS256");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "unknown" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("subject-123")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(unknownKey.privateKey);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(
      AccessTokenVerificationError,
    );
  });
});

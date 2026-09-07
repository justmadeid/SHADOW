import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesGcmIdentifierProtection } from "./identifier-protection.js";

const context = {
  id: "01900000-0000-7000-8000-000000000001",
  entityId: "01900000-0000-7000-8000-000000000002",
  workspaceId: "01900000-0000-7000-8000-000000000003",
  type: "NATIONAL_ID" as const,
  classification: "RESTRICTED" as const,
};

describe("identifier protection", () => {
  const protection = new AesGcmIdentifierProtection(
    { keyId: "encryption-v1", key: Buffer.alloc(32, 1) },
    { keyId: "fingerprint-v1", key: Buffer.alloc(32, 2) },
  );

  it("uses randomized authenticated encryption and a keyed comparison fingerprint", () => {
    const first = protection.protect(context, "3201010101010001");
    const second = protection.protect(context, "3201010101010001");
    expect(first.ciphertext.equals(Buffer.from("3201010101010001"))).toBe(false);
    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(first.comparisonFingerprint.equals(second.comparisonFingerprint)).toBe(true);
    expect(
      first.comparisonFingerprint.equals(
        createHash("sha256").update("3201010101010001").digest(),
      ),
    ).toBe(false);
    expect(protection.reveal(context, first)).toBe("3201010101010001");
  });

  it("domain-separates fingerprints and authenticates stored context", () => {
    const value = protection.protect(context, "3201010101010001");
    expect(
      protection
        .fingerprint(
          "01900000-0000-7000-8000-000000000004",
          context.type,
          "3201010101010001",
        )
        .value.equals(value.comparisonFingerprint),
    ).toBe(false);
    expect(() =>
      protection.reveal(
        { ...context, entityId: "01900000-0000-7000-8000-000000000005" },
        value,
      ),
    ).toThrowError(expect.objectContaining({ code: "IDENTIFIER_VALUE_UNAVAILABLE" }));
    expect(() =>
      protection.reveal(context, {
        ...value,
        authenticationTag: Buffer.alloc(16),
      }),
    ).toThrowError(expect.objectContaining({ code: "IDENTIFIER_VALUE_UNAVAILABLE" }));
  });

  it("rejects reused or incorrectly sized keys", () => {
    expect(
      () =>
        new AesGcmIdentifierProtection(
          { keyId: "same", key: Buffer.alloc(32, 1) },
          { keyId: "same", key: Buffer.alloc(32, 1) },
        ),
    ).toThrowError(
      expect.objectContaining({ code: "IDENTIFIER_KEY_CONFIGURATION_INVALID" }),
    );
    expect(
      () =>
        new AesGcmIdentifierProtection(
          { keyId: "short", key: Buffer.alloc(16) },
          { keyId: "fingerprint", key: Buffer.alloc(32, 2) },
        ),
    ).toThrowError(
      expect.objectContaining({ code: "IDENTIFIER_KEY_CONFIGURATION_INVALID" }),
    );
  });
});

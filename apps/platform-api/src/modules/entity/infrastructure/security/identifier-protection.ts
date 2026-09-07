import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { loadPlatformApiConfig } from "@intelligence/config";
import type { DataClassification } from "@intelligence/contracts";
import { AppError } from "../../../../platform/errors/index.js";
import type { IdentifierType } from "../../domain/identifier.js";

export const IDENTIFIER_PROTECTION = Symbol("IDENTIFIER_PROTECTION");
const CIPHER = "aes-256-gcm";
const FINGERPRINT_ALGORITHM = "HMAC-SHA-256";
const NORMALIZATION_VERSION = 1;

export type IdentifierProtectionContext = {
  id: string;
  entityId: string;
  workspaceId: string;
  type: IdentifierType;
  classification: DataClassification;
};
export type ProtectedIdentifierValue = {
  ciphertext: Buffer;
  nonce: Buffer;
  authenticationTag: Buffer;
  encryptionKeyId: string;
  cipherAlgorithm: typeof CIPHER;
  comparisonFingerprint: Buffer;
  fingerprintKeyId: string;
  fingerprintAlgorithm: typeof FINGERPRINT_ALGORITHM;
  normalizationVersion: typeof NORMALIZATION_VERSION;
};

export interface IdentifierProtection {
  protect(
    context: IdentifierProtectionContext,
    normalizedValue: string,
  ): ProtectedIdentifierValue;
  fingerprint(
    workspaceId: string,
    type: IdentifierType,
    normalizedValue: string,
  ): { value: Buffer; keyId: string };
  reveal(
    context: IdentifierProtectionContext,
    protectedValue: ProtectedIdentifierValue,
  ): string;
}

export class AesGcmIdentifierProtection implements IdentifierProtection {
  constructor(
    private readonly encryption: { keyId: string; key: Buffer },
    private readonly fingerprinting: { keyId: string; key: Buffer },
  ) {
    if (
      encryption.key.length !== 32 ||
      fingerprinting.key.length !== 32 ||
      timingSafeEqual(encryption.key, fingerprinting.key)
    )
      throw configurationError();
  }

  protect(
    context: IdentifierProtectionContext,
    normalizedValue: string,
  ): ProtectedIdentifierValue {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(CIPHER, this.encryption.key, nonce, {
      authTagLength: 16,
    });
    cipher.setAAD(aad(context));
    const ciphertext = Buffer.concat([
      cipher.update(normalizedValue, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext,
      nonce,
      authenticationTag: cipher.getAuthTag(),
      encryptionKeyId: this.encryption.keyId,
      cipherAlgorithm: CIPHER,
      comparisonFingerprint: this.fingerprint(
        context.workspaceId,
        context.type,
        normalizedValue,
      ).value,
      fingerprintKeyId: this.fingerprinting.keyId,
      fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
      normalizationVersion: NORMALIZATION_VERSION,
    };
  }

  fingerprint(workspaceId: string, type: IdentifierType, normalizedValue: string) {
    return {
      value: createHmac("sha256", this.fingerprinting.key)
        .update(
          JSON.stringify([
            "intelligence-platform:identifier-fingerprint",
            NORMALIZATION_VERSION,
            workspaceId,
            type,
            normalizedValue,
          ]),
          "utf8",
        )
        .digest(),
      keyId: this.fingerprinting.keyId,
    };
  }

  reveal(
    context: IdentifierProtectionContext,
    protectedValue: ProtectedIdentifierValue,
  ): string {
    if (
      protectedValue.encryptionKeyId !== this.encryption.keyId ||
      protectedValue.cipherAlgorithm !== CIPHER ||
      protectedValue.fingerprintAlgorithm !== FINGERPRINT_ALGORITHM ||
      protectedValue.normalizationVersion !== NORMALIZATION_VERSION
    )
      throw unavailable();
    try {
      const decipher = createDecipheriv(
        CIPHER,
        this.encryption.key,
        protectedValue.nonce,
        { authTagLength: 16 },
      );
      decipher.setAAD(aad(context));
      decipher.setAuthTag(protectedValue.authenticationTag);
      return Buffer.concat([
        decipher.update(protectedValue.ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw unavailable();
    }
  }
}

/** Defers environment parsing so tests that only use Entity metadata need no key. */
export class EnvironmentIdentifierProtection implements IdentifierProtection {
  private delegate?: AesGcmIdentifierProtection;

  protect(context: IdentifierProtectionContext, normalizedValue: string) {
    return this.get().protect(context, normalizedValue);
  }
  fingerprint(workspaceId: string, type: IdentifierType, normalizedValue: string) {
    return this.get().fingerprint(workspaceId, type, normalizedValue);
  }
  reveal(context: IdentifierProtectionContext, protectedValue: ProtectedIdentifierValue) {
    return this.get().reveal(context, protectedValue);
  }

  private get(): AesGcmIdentifierProtection {
    if (this.delegate) return this.delegate;
    const config = loadPlatformApiConfig();
    this.delegate = new AesGcmIdentifierProtection(
      {
        keyId: config.IDENTIFIER_ENCRYPTION_KEY_ID,
        key: Buffer.from(config.IDENTIFIER_ENCRYPTION_KEY_BASE64, "base64"),
      },
      {
        keyId: config.IDENTIFIER_FINGERPRINT_KEY_ID,
        key: Buffer.from(config.IDENTIFIER_FINGERPRINT_KEY_BASE64, "base64"),
      },
    );
    return this.delegate;
  }
}

export function sameFingerprint(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function aad(context: IdentifierProtectionContext): Buffer {
  return Buffer.from(
    JSON.stringify([
      "intelligence-platform:identifier-ciphertext",
      1,
      context.id,
      context.entityId,
      context.workspaceId,
      context.type,
      context.classification,
    ]),
    "utf8",
  );
}

function configurationError(): AppError {
  return new AppError({
    code: "IDENTIFIER_KEY_CONFIGURATION_INVALID",
    message: "Identifier protection keys are invalid.",
    statusCode: 500,
  });
}

function unavailable(): AppError {
  return new AppError({
    code: "IDENTIFIER_VALUE_UNAVAILABLE",
    message: "Protected identifier value is unavailable.",
    statusCode: 503,
  });
}

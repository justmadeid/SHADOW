import {
  DATA_CLASSIFICATIONS,
  type ClassifiedFieldView,
  type DataClassification,
} from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";

export const IDENTIFIER_TYPES = [
  "NATIONAL_ID",
  "PHONE",
  "EMAIL",
  "PLATFORM_USER_ID",
  "USERNAME",
  "INTERNAL_RESIDENT_ID",
] as const;
export const IDENTIFIER_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];
export type IdentifierStatus = (typeof IDENTIFIER_STATUSES)[number];

/** Metadata-only snapshot. Protected value material is infrastructure-private. */
export type EntityIdentifier = Readonly<{
  id: string;
  entityId: string;
  workspaceId: string;
  type: IdentifierType;
  classification: DataClassification;
  status: IdentifierStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export type IdentifierView = EntityIdentifier & ClassifiedFieldView;
export type CreateIdentifierInput = {
  type: IdentifierType;
  value: string;
  classification: DataClassification;
};

export function normalizeCreateIdentifier(
  input: CreateIdentifierInput,
): CreateIdentifierInput {
  if (
    !IDENTIFIER_TYPES.includes(input.type) ||
    !DATA_CLASSIFICATIONS.includes(input.classification)
  )
    invalid();
  return Object.freeze({
    type: input.type,
    classification: input.classification,
    value: normalizeIdentifierValue(input.type, input.value),
  });
}

export function normalizeIdentifierValue(type: IdentifierType, value: unknown): string {
  if (typeof value !== "string" || hasControlCharacters(value)) invalid();
  const compact = value.normalize("NFKC").trim();
  if (
    compact.length < 3 ||
    compact.length > 320 ||
    Buffer.byteLength(compact, "utf8") > 320 ||
    hasControlCharacters(compact)
  )
    invalid();
  switch (type) {
    case "NATIONAL_ID":
      if (!/^\d{6,32}$/u.test(compact.replace(/[ -]/gu, ""))) invalid();
      return compact.replace(/[ -]/gu, "");
    case "PHONE": {
      const normalized = compact.replace(/[ ()-]/gu, "");
      if (!/^\+[1-9]\d{7,14}$/u.test(normalized)) invalid();
      return normalized;
    }
    case "EMAIL": {
      const normalized = compact.toLocaleLowerCase("en-US");
      if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized))
        invalid();
      return normalized;
    }
    case "USERNAME":
      if (!/^[\p{L}\p{N}._@+-]{3,128}$/u.test(compact)) invalid();
      return compact.toLocaleLowerCase("en-US");
    case "PLATFORM_USER_ID":
    case "INTERNAL_RESIDENT_ID":
      if (!/^[\p{L}\p{N}._:@/+\-=]{3,200}$/u.test(compact)) invalid();
      return compact;
  }
}

export function maskedIdentifier(value: EntityIdentifier): IdentifierView {
  return Object.freeze({
    ...value,
    visibility: "MASKED",
    displayValue: "••••",
  });
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 31 || code === 127;
  });
}

function invalid(): never {
  throw new AppError({
    code: "VALIDATION_IDENTIFIER_INVALID",
    message: "Identifier input is invalid.",
    statusCode: 400,
  });
}

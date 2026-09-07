import { AppError } from "../../../platform/errors/index.js";
import { normalizeCreateIdentifier, type CreateIdentifierInput } from "./identifier.js";

export function parseCreateIdentifier(value: unknown): CreateIdentifierInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["type", "value", "classification"].includes(key),
    ) ||
    typeof input.type !== "string" ||
    typeof input.value !== "string" ||
    typeof input.classification !== "string"
  )
    invalid();
  return normalizeCreateIdentifier(input as CreateIdentifierInput);
}

function invalid(): never {
  throw new AppError({
    code: "VALIDATION_IDENTIFIER_INVALID",
    message: "Identifier input is invalid.",
    statusCode: 400,
  });
}

import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import {
  ENTITY_MERGE_REASON_CODES,
  ENTITY_MERGE_REVERSE_REASON_CODES,
  ENTITY_TYPES,
  type CreateEntityInput,
  type MergeEntityInput,
  type ReverseEntityMergeInput,
  type EntityType,
  type UpdateEntityInput,
} from "./entity.js";

export function parseCreateEntity(value: unknown): CreateEntityInput {
  const body = record(value, ["type", "canonicalLabel", "aliases"]);
  if (
    !ENTITY_TYPES.includes(body.type as EntityType) ||
    typeof body.canonicalLabel !== "string" ||
    (body.aliases !== undefined &&
      (!Array.isArray(body.aliases) ||
        body.aliases.some((alias) => typeof alias !== "string")))
  )
    invalid();
  return {
    type: body.type as EntityType,
    canonicalLabel: body.canonicalLabel,
    ...(body.aliases !== undefined ? { aliases: body.aliases as readonly string[] } : {}),
  };
}

export function parseUpdateEntity(value: unknown): UpdateEntityInput {
  const body = record(value, ["canonicalLabel", "alias", "status"]);
  if (Object.keys(body).length !== 1) invalid();
  if (typeof body.canonicalLabel === "string")
    return { canonicalLabel: body.canonicalLabel };
  if (typeof body.alias === "string") return { alias: body.alias };
  if (body.status === "ARCHIVED") return { status: "ARCHIVED" };
  return invalid();
}

export function parseMergeEntity(value: unknown): MergeEntityInput {
  const body = record(value, ["absorbedEntityId", "absorbedRevision", "reasonCode"]);
  if (
    typeof body.absorbedEntityId !== "string" ||
    !isResourceId(body.absorbedEntityId) ||
    typeof body.absorbedRevision !== "number" ||
    !Number.isSafeInteger(body.absorbedRevision) ||
    body.absorbedRevision < 1 ||
    !ENTITY_MERGE_REASON_CODES.includes(body.reasonCode as never)
  )
    invalid();
  return {
    absorbedEntityId: body.absorbedEntityId,
    absorbedRevision: body.absorbedRevision,
    reasonCode: body.reasonCode as MergeEntityInput["reasonCode"],
  };
}

export function parseReverseEntityMerge(value: unknown): ReverseEntityMergeInput {
  const body = record(value, ["survivorRevision", "absorbedRevision", "reasonCode"]);
  if (
    typeof body.survivorRevision !== "number" ||
    !Number.isSafeInteger(body.survivorRevision) ||
    body.survivorRevision < 1 ||
    typeof body.absorbedRevision !== "number" ||
    !Number.isSafeInteger(body.absorbedRevision) ||
    body.absorbedRevision < 1 ||
    !ENTITY_MERGE_REVERSE_REASON_CODES.includes(body.reasonCode as never)
  )
    invalid();
  return {
    survivorRevision: body.survivorRevision,
    absorbedRevision: body.absorbedRevision,
    reasonCode: body.reasonCode as ReverseEntityMergeInput["reasonCode"],
  };
}

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key))) invalid();
  return body;
}
function invalid(): never {
  throw new AppError({
    code: "VALIDATION_ENTITY_INVALID",
    message: "Entity request body is invalid.",
    statusCode: 400,
  });
}

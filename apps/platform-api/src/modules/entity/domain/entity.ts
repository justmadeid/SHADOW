import { isResourceId, type ResourceRef } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";

export const ENTITY_TYPES = [
  "PERSON",
  "ORGANIZATION",
  "SOCIAL_ACCOUNT",
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "LOCATION",
  "ADDRESS",
  "DOMAIN",
  "WEBSITE",
  "IP_ADDRESS",
  "VEHICLE",
  "DEVICE",
  "DOCUMENT",
  "EVENT",
] as const;
export const ENTITY_STATUSES = ["ACTIVE", "MERGED", "ARCHIVED"] as const;
export const ENTITY_MERGE_REASON_CODES = [
  "DUPLICATE_IDENTITY",
  "EXACT_IDENTIFIER_MATCH",
  "MULTIPLE_SUPPORTING_SIGNALS",
  "DATA_CORRECTION",
  "MANUAL_REVIEW",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export type EntityStatus = (typeof ENTITY_STATUSES)[number];
export type EntityMergeReasonCode = (typeof ENTITY_MERGE_REASON_CODES)[number];
export type EntityRef = Readonly<
  Pick<ResourceRef, "id" | "workspaceId"> & { type: "ENTITY" }
>;
export type EntityAlias = Readonly<{
  id: string;
  label: string;
  createdAt: string;
}>;

/** Reusable identity only. Case interpretation belongs to Subject/Knowledge. */
export type Entity = Readonly<{
  id: string;
  workspaceId: string;
  type: EntityType;
  status: EntityStatus;
  canonicalLabel: string;
  aliases: readonly EntityAlias[];
  mergedInto: EntityRef | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateEntityInput = {
  type: EntityType;
  canonicalLabel: string;
  aliases?: readonly string[];
};
export type UpdateEntityInput =
  { canonicalLabel: string } | { alias: string } | { status: "ARCHIVED" };
export type MergeEntityInput = {
  absorbedEntityId: string;
  absorbedRevision: number;
  reasonCode: EntityMergeReasonCode;
};
export type EntityMergeDecision = Readonly<{
  id: string;
  operationId: string;
  workspaceId: string;
  survivorEntityId: string;
  absorbedEntityId: string;
  survivorRevision: number;
  absorbedRevision: number;
  reasonCode: EntityMergeReasonCode;
  createdAt: string;
}>;

export function normalizeCreateEntity(input: CreateEntityInput): CreateEntityInput {
  if (!ENTITY_TYPES.includes(input.type)) invalid();
  const canonicalLabel = normalizeEntityLabel(input.canonicalLabel);
  if (!Array.isArray(input.aliases ?? [])) invalid();
  if ((input.aliases?.length ?? 0) > 20) invalid();
  const aliases = normalizeAliases(input.aliases ?? [], canonicalLabel);
  return Object.freeze({
    type: input.type,
    canonicalLabel,
    aliases: Object.freeze(aliases),
  });
}

export function createEntity(
  input: Omit<CreateEntityInput, "aliases"> & {
    id: string;
    workspaceId: string;
    aliases: readonly EntityAlias[];
  },
  now: Date,
): Entity {
  validateId(input.id);
  validateId(input.workspaceId);
  const normalized = normalizeCreateEntity({
    type: input.type,
    canonicalLabel: input.canonicalLabel,
    aliases: input.aliases.map((alias) => alias.label),
  });
  const timestamp = instant(now);
  if (
    normalized.aliases?.length !== input.aliases.length ||
    input.aliases.some(
      (alias, index) =>
        !isResourceId(alias.id) ||
        alias.label !== normalized.aliases?.[index] ||
        instant(new Date(alias.createdAt)) !== timestamp,
    )
  )
    invalid();
  return freeze({
    id: input.id,
    workspaceId: input.workspaceId,
    type: input.type,
    status: "ACTIVE",
    canonicalLabel: normalized.canonicalLabel,
    aliases: input.aliases,
    mergedInto: null,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function renameEntity(
  current: Entity,
  canonicalLabel: string,
  oldLabelAlias: EntityAlias | null,
  expectedRevision: number,
  now: Date,
): Entity {
  mutable(current, expectedRevision);
  const label = normalizeEntityLabel(canonicalLabel);
  if (labelKey(label) === labelKey(current.canonicalLabel)) invalid();
  const aliases = [...current.aliases];
  if (
    !aliases.some((alias) => labelKey(alias.label) === labelKey(current.canonicalLabel))
  ) {
    if (!oldLabelAlias || !isResourceId(oldLabelAlias.id)) invalid();
    if (normalizeEntityLabel(oldLabelAlias.label) !== current.canonicalLabel) invalid();
    aliases.push(Object.freeze({ ...oldLabelAlias, createdAt: instant(now) }));
  }
  return next(
    current,
    {
      canonicalLabel: label,
      aliases: aliases.filter((alias) => labelKey(alias.label) !== labelKey(label)),
    },
    now,
  );
}

export function addEntityAlias(
  current: Entity,
  alias: EntityAlias,
  expectedRevision: number,
  now: Date,
): Entity {
  mutable(current, expectedRevision);
  if (!isResourceId(alias.id)) invalid();
  const label = normalizeEntityLabel(alias.label);
  if (
    labelKey(label) === labelKey(current.canonicalLabel) ||
    current.aliases.some(
      (currentAlias) => labelKey(currentAlias.label) === labelKey(label),
    )
  )
    throw new AppError({
      code: "ENTITY_ALIAS_CONFLICT",
      message: "Entity alias already identifies this Entity.",
      statusCode: 409,
    });
  return next(
    current,
    {
      aliases: [
        ...current.aliases,
        Object.freeze({ ...alias, label, createdAt: instant(now) }),
      ],
    },
    now,
  );
}

export function archiveEntity(
  current: Entity,
  expectedRevision: number,
  now: Date,
): Entity {
  mutable(current, expectedRevision);
  return next(current, { status: "ARCHIVED" }, now);
}

export function mergeEntities(
  survivor: Entity,
  absorbed: Entity,
  survivorExpectedRevision: number,
  absorbedExpectedRevision: number,
  now: Date,
): { survivor: Entity; absorbed: Entity } {
  if (survivor.id === absorbed.id)
    throw new AppError({
      code: "ENTITY_MERGE_INVALID_TARGET",
      message: "An Entity cannot be merged into itself.",
      statusCode: 409,
    });
  mutable(survivor, survivorExpectedRevision);
  mutable(absorbed, absorbedExpectedRevision);
  if (survivor.workspaceId !== absorbed.workspaceId || survivor.type !== absorbed.type)
    throw new AppError({
      code: "ENTITY_MERGE_INCOMPATIBLE",
      message: "Only active Entities of the same type and Workspace can be merged.",
      statusCode: 409,
    });
  return {
    survivor: next(survivor, {}, now),
    absorbed: next(
      absorbed,
      {
        status: "MERGED",
        mergedInto: {
          type: "ENTITY",
          id: survivor.id,
          workspaceId: survivor.workspaceId,
        },
      },
      now,
    ),
  };
}

export function normalizeEntityLabel(value: unknown): string {
  if (typeof value !== "string") invalid();
  if (hasControlCharacters(value)) invalid();
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (
    normalized.length < 1 ||
    normalized.length > 200 ||
    hasControlCharacters(normalized)
  )
    invalid();
  return normalized;
}

export function labelKey(value: string): string {
  return normalizeEntityLabel(value).toLocaleLowerCase("en-US");
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 31 || code === 127;
  });
}

function normalizeAliases(values: readonly string[], canonicalLabel: string): string[] {
  const seen = new Set([labelKey(canonicalLabel)]);
  return values
    .map(normalizeEntityLabel)
    .sort((left, right) => labelKey(left).localeCompare(labelKey(right)))
    .map((alias) => {
      const key = labelKey(alias);
      if (seen.has(key)) invalid();
      seen.add(key);
      return alias;
    });
}

function mutable(current: Entity, expectedRevision: number): void {
  assertExpectedRevision(expectedRevision, current.revision);
  if (current.status !== "ACTIVE")
    throw new AppError({
      code: "ENTITY_INVALID_STATUS_TRANSITION",
      message: "Entity status does not allow this mutation.",
      statusCode: 409,
    });
  if (!Number.isSafeInteger(current.revision) || current.revision < 1) invalid();
}

function next(
  current: Entity,
  changes: Partial<Pick<Entity, "canonicalLabel" | "aliases" | "status" | "mergedInto">>,
  now: Date,
): Entity {
  const updatedAt = instant(now);
  if (updatedAt < current.updatedAt || current.revision === Number.MAX_SAFE_INTEGER)
    invalid();
  return freeze({
    ...current,
    ...changes,
    revision: current.revision + 1,
    updatedAt,
  });
}

function freeze(value: Entity): Entity {
  return Object.freeze({
    ...value,
    aliases: Object.freeze(value.aliases.map((alias) => Object.freeze({ ...alias }))),
    mergedInto: value.mergedInto ? Object.freeze({ ...value.mergedInto }) : null,
  });
}

function validateId(value: string): void {
  if (!isResourceId(value)) invalid();
}
function instant(value: Date): string {
  if (!Number.isFinite(value.getTime())) invalid();
  return value.toISOString();
}
function invalid(): never {
  throw new AppError({
    code: "VALIDATION_ENTITY_INVALID",
    message: "Entity input is invalid.",
    statusCode: 400,
  });
}

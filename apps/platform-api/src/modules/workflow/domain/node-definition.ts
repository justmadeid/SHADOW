import { DATA_CLASSIFICATIONS, type DataClassification } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import { PERMISSIONS, type Permission } from "../../governance/index.js";

export const NODE_FIELD_TYPES = [
  "STRING",
  "NUMBER",
  "BOOLEAN",
  "DATE",
  "IDENTIFIER",
  "RESOURCE_REF",
] as const;
export type NodeFieldType = (typeof NODE_FIELD_TYPES)[number];

export const NODE_DEFINITION_CATEGORIES = [
  "COLLECTION",
  "ENRICHMENT",
  "ANALYSIS",
] as const;
export type NodeDefinitionCategory = (typeof NODE_DEFINITION_CATEGORIES)[number];

export const NODE_DEFINITION_STATUSES = ["ACTIVE", "DEPRECATED"] as const;
export type NodeDefinitionStatus = (typeof NODE_DEFINITION_STATUSES)[number];

const NODE_FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_.]{0,63}$/;
export const NODE_DEFINITION_KEY_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const NODE_DEFINITION_KEY = NODE_DEFINITION_KEY_PATTERN;
// Abstract capability token only. Never a connector id (e.g. "resident-api-v1").
const NODE_DEFINITION_CAPABILITY = /^[A-Z][A-Z0-9_]{2,63}$/;

export type NodeField = {
  name: string;
  type: NodeFieldType;
  required: boolean;
  classification?: DataClassification;
};

export type NodeDefinition = Readonly<{
  id: string;
  key: string;
  version: number;
  category: NodeDefinitionCategory;
  capability: string;
  inputs: readonly NodeField[];
  outputs: readonly NodeField[];
  configSchema: readonly NodeField[];
  executionPolicy: Readonly<{ timeoutSeconds: number; retryable: boolean }>;
  reviewPolicy: Readonly<{ requiresHumanReview: boolean }>;
  requiredPermission: Permission;
  presentation: Readonly<{ label: string; description: string }>;
  status: NodeDefinitionStatus;
  createdAt: Date;
}>;

/**
 * Fields accepted when defining a NodeDefinition. This is a capability
 * request, never a connector implementation: no connectorId/connector/
 * sourceId key is permitted, even if the caller supplies one (mass-assignment
 * guard, same posture as subject-input.ts's record() helper). This is the
 * literal P3-001 acceptance criterion and must stay structurally enforced.
 */
export type NodeDefinitionInput = {
  key: string;
  version: number;
  category: NodeDefinitionCategory;
  capability: string;
  inputs: NodeField[];
  outputs: NodeField[];
  configSchema: NodeField[];
  executionPolicy: { timeoutSeconds: number; retryable: boolean };
  reviewPolicy: { requiresHumanReview: boolean };
  requiredPermission: Permission;
  presentation: { label: string; description: string };
};

const DEFINITION_ALLOWED_KEYS = [
  "key",
  "version",
  "category",
  "capability",
  "inputs",
  "outputs",
  "configSchema",
  "executionPolicy",
  "reviewPolicy",
  "requiredPermission",
  "presentation",
];
const FIELD_ALLOWED_KEYS = ["name", "type", "required", "classification"];
const FORBIDDEN_KEYS = ["connectorId", "connector", "sourceId"];

/**
 * Parses a trusted NodeDefinition registration request. Strict allow-list
 * parsing rejects any connectorId/connector/sourceId key outright, structurally
 * enforcing that a NodeDefinition requests an abstract capability rather than
 * naming a connector implementation.
 */
export function parseNodeDefinitionInput(value: unknown): NodeDefinitionInput {
  const body = record(value, DEFINITION_ALLOWED_KEYS);

  if (typeof body.key !== "string" || !NODE_DEFINITION_KEY.test(body.key)) invalid("key");
  if (!Number.isSafeInteger(body.version) || (body.version as number) < 1)
    invalid("version");
  if (!NODE_DEFINITION_CATEGORIES.includes(body.category as NodeDefinitionCategory))
    invalid("category");
  if (
    typeof body.capability !== "string" ||
    !NODE_DEFINITION_CAPABILITY.test(body.capability)
  )
    invalid("capability");

  const inputs = parseFieldList(body.inputs, "inputs", 1, 20);
  const outputs = parseFieldList(body.outputs, "outputs", 0, 20);
  const configSchema = parseFieldList(body.configSchema, "configSchema", 0, 20);

  const executionPolicy = record(body.executionPolicy, ["timeoutSeconds", "retryable"]);
  if (
    !Number.isSafeInteger(executionPolicy.timeoutSeconds) ||
    (executionPolicy.timeoutSeconds as number) < 1 ||
    (executionPolicy.timeoutSeconds as number) > 3600
  )
    invalid("executionPolicy.timeoutSeconds");
  if (typeof executionPolicy.retryable !== "boolean")
    invalid("executionPolicy.retryable");

  const reviewPolicy = record(body.reviewPolicy, ["requiresHumanReview"]);
  if (typeof reviewPolicy.requiresHumanReview !== "boolean")
    invalid("reviewPolicy.requiresHumanReview");

  if (
    typeof body.requiredPermission !== "string" ||
    !(PERMISSIONS as readonly string[]).includes(body.requiredPermission)
  )
    invalid("requiredPermission");

  const presentation = record(body.presentation, ["label", "description"]);
  if (
    typeof presentation.label !== "string" ||
    presentation.label.trim().length < 1 ||
    presentation.label.length > 120
  )
    invalid("presentation.label");
  if (
    typeof presentation.description !== "string" ||
    presentation.description.trim().length < 1 ||
    presentation.description.length > 1000
  )
    invalid("presentation.description");

  return {
    key: body.key,
    version: body.version as number,
    category: body.category as NodeDefinitionCategory,
    capability: body.capability,
    inputs,
    outputs,
    configSchema,
    executionPolicy: {
      timeoutSeconds: executionPolicy.timeoutSeconds as number,
      retryable: executionPolicy.retryable as boolean,
    },
    reviewPolicy: { requiresHumanReview: reviewPolicy.requiresHumanReview as boolean },
    requiredPermission: body.requiredPermission as Permission,
    presentation: {
      label: presentation.label.trim(),
      description: presentation.description.trim(),
    },
  };
}

function parseFieldList(
  value: unknown,
  label: string,
  min: number,
  max: number,
): NodeField[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(label);
  const fields = value.map((entry) => parseField(entry, label));
  const names = new Set(fields.map((field) => field.name));
  if (names.size !== fields.length) invalid(`${label} contains duplicate names`);
  return fields;
}

function parseField(value: unknown, label: string): NodeField {
  const body = record(value, FIELD_ALLOWED_KEYS);
  if (typeof body.name !== "string" || !NODE_FIELD_NAME.test(body.name))
    invalid(`${label}.name`);
  if (!NODE_FIELD_TYPES.includes(body.type as NodeFieldType)) invalid(`${label}.type`);
  if (typeof body.required !== "boolean") invalid(`${label}.required`);
  if (
    body.classification !== undefined &&
    !DATA_CLASSIFICATIONS.includes(body.classification as DataClassification)
  )
    invalid(`${label}.classification`);
  return {
    name: body.name,
    type: body.type as NodeFieldType,
    required: body.required,
    ...(body.classification === undefined
      ? {}
      : { classification: body.classification as DataClassification }),
  };
}

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("body");
  const body = value as Record<string, unknown>;
  const disallowed = Object.keys(body).filter(
    (key) => !allowed.includes(key) || FORBIDDEN_KEYS.includes(key),
  );
  if (disallowed.length > 0)
    throw new AppError({
      code: "VALIDATION_NODE_DEFINITION_INVALID",
      message:
        "NodeDefinition input must not contain unknown or connector-implementation fields.",
      statusCode: 400,
      details: { field: disallowed[0] },
    });
  return body;
}

function invalid(field: string): never {
  throw new AppError({
    code: "VALIDATION_NODE_DEFINITION_INVALID",
    message: "NodeDefinition input is invalid.",
    statusCode: 400,
    details: { field },
  });
}

/** Structural equality used to decide whether a key+version replay is idempotent. */
export function sameNodeDefinitionShape(
  a: NodeDefinitionInput,
  b: NodeDefinitionInput,
): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function canonicalize(input: NodeDefinitionInput) {
  return {
    key: input.key,
    version: input.version,
    category: input.category,
    capability: input.capability,
    inputs: input.inputs,
    outputs: input.outputs,
    configSchema: input.configSchema,
    executionPolicy: input.executionPolicy,
    reviewPolicy: input.reviewPolicy,
    requiredPermission: input.requiredPermission,
    presentation: input.presentation,
  };
}

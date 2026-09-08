import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import type { NodeField, NodeFieldType } from "./node-definition.js";

export const NODE_INSTANCE_STATUSES = ["DRAFT", "READY", "ARCHIVED"] as const;
export type NodeInstanceStatus = (typeof NODE_INSTANCE_STATUSES)[number];

export type NodeInstanceConfigurationValue = string | number | boolean;
export type NodeInstanceConfiguration = Record<string, NodeInstanceConfigurationValue>;

export type NodeInstance = Readonly<{
  id: string;
  workspaceId: string;
  caseId: string;
  investigationId: string;
  nodeDefinitionKey: string;
  nodeDefinitionVersion: number;
  configuration: NodeInstanceConfiguration;
  status: NodeInstanceStatus;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}>;

/**
 * Validates a raw configuration object against a NodeDefinition's configSchema:
 * every required field must be present, every present field's runtime type
 * must match its declared NodeFieldType, and unknown keys are rejected.
 */
export function validateConfigurationAgainstSchema(
  configuration: unknown,
  schema: readonly NodeField[],
): NodeInstanceConfiguration {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration))
    invalid("configuration");
  const body = configuration as Record<string, unknown>;
  const schemaByName = new Map(schema.map((field) => [field.name, field]));

  for (const key of Object.keys(body)) {
    if (!schemaByName.has(key))
      invalid(`configuration.${key}`, "Unknown configuration key.");
  }
  for (const field of schema) {
    if (field.required && !(field.name in body))
      invalid(`configuration.${field.name}`, "Required configuration field is missing.");
  }
  const result: NodeInstanceConfiguration = {};
  for (const [key, value] of Object.entries(body)) {
    const field = schemaByName.get(key)!;
    if (!matchesType(value, field.type))
      invalid(`configuration.${key}`, "Configuration value type does not match schema.");
    result[key] = value as NodeInstanceConfigurationValue;
  }
  return result;
}

function matchesType(value: unknown, type: NodeFieldType): boolean {
  switch (type) {
    case "NUMBER":
      return typeof value === "number" && Number.isFinite(value);
    case "BOOLEAN":
      return typeof value === "boolean";
    case "STRING":
    case "DATE":
    case "IDENTIFIER":
    case "RESOURCE_REF":
      return typeof value === "string";
    default:
      return false;
  }
}

/** True iff every required NodeDefinition input has a bound targetInput. */
export function computeReadiness(
  requiredInputNames: readonly string[],
  boundTargetInputs: readonly string[],
): boolean {
  const bound = new Set(boundTargetInputs);
  return requiredInputNames.every((name) => bound.has(name));
}

export function createNodeInstance(
  input: {
    id: string;
    workspaceId: string;
    caseId: string;
    investigationId: string;
    nodeDefinitionKey: string;
    nodeDefinitionVersion: number;
    configuration: NodeInstanceConfiguration;
    ready: boolean;
  },
  now: Date,
): NodeInstance {
  for (const id of [input.id, input.workspaceId, input.caseId, input.investigationId])
    if (!isResourceId(id)) invalid("id");
  return Object.freeze({
    id: input.id,
    workspaceId: input.workspaceId,
    caseId: input.caseId,
    investigationId: input.investigationId,
    nodeDefinitionKey: input.nodeDefinitionKey,
    nodeDefinitionVersion: input.nodeDefinitionVersion,
    configuration: Object.freeze({ ...input.configuration }),
    status: input.ready ? "READY" : "DRAFT",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
}

export function assertMutable(current: NodeInstance): void {
  if (current.status === "ARCHIVED")
    throw new AppError({
      code: "NODE_INSTANCE_ARCHIVED",
      message: "An archived NodeInstance cannot be changed.",
      statusCode: 409,
    });
}

export function nextRevision(
  current: NodeInstance,
  expectedRevision: number,
  changes: Partial<Pick<NodeInstance, "configuration" | "status">>,
  now: Date,
): NodeInstance {
  assertExpectedRevision(expectedRevision, current.revision);
  assertMutable(current);
  return Object.freeze({
    ...current,
    ...changes,
    configuration: Object.freeze({
      ...(changes.configuration ?? current.configuration),
    }),
    revision: current.revision + 1,
    updatedAt: now,
  });
}

export function archiveNodeInstance(
  current: NodeInstance,
  expectedRevision: number,
  now: Date,
): NodeInstance {
  const next = nextRevision(current, expectedRevision, { status: "ARCHIVED" }, now);
  return Object.freeze({ ...next, archivedAt: now });
}

function invalid(field: string, message = "NodeInstance input is invalid."): never {
  throw new AppError({
    code: "VALIDATION_NODE_INSTANCE_INVALID",
    message,
    statusCode: 400,
    details: { field },
  });
}

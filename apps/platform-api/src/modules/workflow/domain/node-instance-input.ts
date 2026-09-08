import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import { NODE_DEFINITION_KEY_PATTERN } from "./node-definition.js";

export type CreateNodeInstanceBody = {
  nodeDefinitionKey: string;
  nodeDefinitionVersion: number;
  configuration: Record<string, unknown>;
};

export function parseCreateNodeInstanceBody(value: unknown): CreateNodeInstanceBody {
  const body = record(value, [
    "nodeDefinitionKey",
    "nodeDefinitionVersion",
    "configuration",
  ]);
  if (
    typeof body.nodeDefinitionKey !== "string" ||
    !NODE_DEFINITION_KEY_PATTERN.test(body.nodeDefinitionKey)
  )
    invalid();
  if (
    !Number.isSafeInteger(body.nodeDefinitionVersion) ||
    (body.nodeDefinitionVersion as number) < 1
  )
    invalid();
  if (
    body.configuration !== undefined &&
    (typeof body.configuration !== "object" ||
      body.configuration === null ||
      Array.isArray(body.configuration))
  )
    invalid();
  return {
    nodeDefinitionKey: body.nodeDefinitionKey,
    nodeDefinitionVersion: body.nodeDefinitionVersion as number,
    configuration: (body.configuration as Record<string, unknown> | undefined) ?? {},
  };
}

export type UpdateNodeInstanceBody = { configuration: Record<string, unknown> };

export function parseUpdateNodeInstanceBody(value: unknown): UpdateNodeInstanceBody {
  const body = record(value, ["configuration"]);
  if (
    !body.configuration ||
    typeof body.configuration !== "object" ||
    Array.isArray(body.configuration)
  )
    invalid();
  return { configuration: body.configuration as Record<string, unknown> };
}

export function parseInputBindingsBody(value: unknown): unknown[] {
  const body = record(value, ["bindings"]);
  if (!Array.isArray(body.bindings)) invalid();
  return body.bindings;
}

export type CreateWorkflowEdgeBody = {
  fromNodeInstanceId: string;
  toNodeInstanceId: string;
};

export function parseCreateWorkflowEdgeBody(value: unknown): CreateWorkflowEdgeBody {
  const body = record(value, ["fromNodeInstanceId", "toNodeInstanceId"]);
  if (
    typeof body.fromNodeInstanceId !== "string" ||
    !isResourceId(body.fromNodeInstanceId) ||
    typeof body.toNodeInstanceId !== "string" ||
    !isResourceId(body.toNodeInstanceId)
  )
    invalid();
  return {
    fromNodeInstanceId: body.fromNodeInstanceId,
    toNodeInstanceId: body.toNodeInstanceId,
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
    code: "VALIDATION_NODE_INSTANCE_INVALID",
    message: "NodeInstance request body is invalid.",
    statusCode: 400,
  });
}

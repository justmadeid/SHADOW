import { DATA_CLASSIFICATIONS, type DataClassification } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import {
  NODE_FIELD_TYPES,
  type NodeField,
  type NodeFieldType,
} from "./node-definition.js";

export type InputBinding = Readonly<{
  targetInput: string;
  sourceExpression: string;
  sourceType: NodeFieldType;
  sourceClassification: DataClassification | null;
}>;

const ALLOWED_KEYS = [
  "targetInput",
  "sourceExpression",
  "sourceType",
  "sourceClassification",
];

/**
 * Validates a full replacement InputBinding set against a NodeDefinition's
 * declared inputs: every targetInput must exist among `inputs`, there must be
 * no duplicate targetInput, and sourceType must equal the target input's
 * declared type (the literal P3-002 acceptance criterion). Any violation
 * throws VALIDATION_INPUT_BINDING_INVALID before anything is persisted.
 */
export function validateInputBindings(
  value: unknown,
  nodeDefinitionInputs: readonly NodeField[],
): InputBinding[] {
  if (!Array.isArray(value) || value.length > 20) invalid("bindings");
  const inputsByName = new Map(nodeDefinitionInputs.map((field) => [field.name, field]));
  const seen = new Set<string>();
  const bindings = value.map((entry) => {
    const body = record(entry);
    if (typeof body.targetInput !== "string" || !inputsByName.has(body.targetInput))
      invalid("targetInput", "targetInput must match a declared NodeDefinition input.");
    if (seen.has(body.targetInput as string))
      invalid("targetInput", "Duplicate targetInput in the binding set.");
    seen.add(body.targetInput as string);

    if (
      typeof body.sourceExpression !== "string" ||
      body.sourceExpression.trim().length < 1 ||
      body.sourceExpression.length > 200
    )
      invalid("sourceExpression");

    if (!NODE_FIELD_TYPES.includes(body.sourceType as NodeFieldType))
      invalid("sourceType");

    const target = inputsByName.get(body.targetInput as string)!;
    if (body.sourceType !== target.type)
      invalid("sourceType", "sourceType must equal the target input's declared type.");

    if (
      body.sourceClassification !== undefined &&
      body.sourceClassification !== null &&
      !DATA_CLASSIFICATIONS.includes(body.sourceClassification as DataClassification)
    )
      invalid("sourceClassification");

    return Object.freeze({
      targetInput: body.targetInput as string,
      sourceExpression: body.sourceExpression as string,
      sourceType: body.sourceType as NodeFieldType,
      sourceClassification:
        (body.sourceClassification as DataClassification | undefined) ?? null,
    });
  });
  return bindings;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("binding");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.includes(key))) invalid("binding");
  return body;
}

function invalid(field: string, message = "InputBinding request is invalid."): never {
  throw new AppError({
    code: "VALIDATION_INPUT_BINDING_INVALID",
    message,
    statusCode: 400,
    details: { field },
  });
}

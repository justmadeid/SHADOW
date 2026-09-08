import { describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/index.js";
import {
  parseNodeDefinitionInput,
  sameNodeDefinitionShape,
  type NodeDefinitionInput,
} from "./node-definition.js";

function validInput(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    key: "person-lookup",
    version: 1,
    category: "COLLECTION",
    capability: "PERSON_LOOKUP",
    inputs: [{ name: "fullName", type: "STRING", required: true }],
    outputs: [{ name: "matchCount", type: "NUMBER", required: false }],
    configSchema: [{ name: "timeoutOverride", type: "NUMBER", required: false }],
    executionPolicy: { timeoutSeconds: 30, retryable: true },
    reviewPolicy: { requiresHumanReview: false },
    requiredPermission: "WORKFLOW_CREATE",
    presentation: { label: "Person Lookup", description: "Looks up a person by name." },
    ...overrides,
  };
}

describe("parseNodeDefinitionInput", () => {
  it("parses a well-formed capability request", () => {
    const parsed = parseNodeDefinitionInput(validInput());
    expect(parsed.key).toBe("person-lookup");
    expect(parsed.capability).toBe("PERSON_LOOKUP");
    expect(parsed.inputs).toHaveLength(1);
  });

  it.each(["connectorId", "connector", "sourceId"])(
    "rejects a %s key structurally (NodeDefinition requests capability, not connector implementation)",
    (forbiddenKey) => {
      const body = validInput({ [forbiddenKey]: "resident-api-v1" });
      expect(() => parseNodeDefinitionInput(body)).toThrow(AppError);
      try {
        parseNodeDefinitionInput(body);
      } catch (error) {
        expect((error as AppError).code).toBe("VALIDATION_NODE_DEFINITION_INVALID");
      }
    },
  );

  it("rejects a capability token that resembles a connector id", () => {
    expect(() =>
      parseNodeDefinitionInput(validInput({ capability: "resident-api-v1" })),
    ).toThrow(AppError);
  });

  it("rejects an unknown top-level field (mass-assignment guard)", () => {
    expect(() => parseNodeDefinitionInput(validInput({ extra: "nope" }))).toThrow(
      AppError,
    );
  });

  it("rejects duplicate input names", () => {
    const body = validInput({
      inputs: [
        { name: "fullName", type: "STRING", required: true },
        { name: "fullName", type: "STRING", required: false },
      ],
    });
    expect(() => parseNodeDefinitionInput(body)).toThrow(AppError);
  });

  it("rejects an out-of-range execution timeout", () => {
    expect(() =>
      parseNodeDefinitionInput(
        validInput({ executionPolicy: { timeoutSeconds: 0, retryable: true } }),
      ),
    ).toThrow(AppError);
  });

  it("rejects a requiredPermission that Governance does not register", () => {
    expect(() =>
      parseNodeDefinitionInput(validInput({ requiredPermission: "NOT_A_PERMISSION" })),
    ).toThrow(AppError);
  });

  it("rejects an empty inputs array (at least one required)", () => {
    expect(() => parseNodeDefinitionInput(validInput({ inputs: [] }))).toThrow(AppError);
  });
});

describe("sameNodeDefinitionShape", () => {
  it("treats structurally identical input as the same shape", () => {
    const a = parseNodeDefinitionInput(validInput()) as NodeDefinitionInput;
    const b = parseNodeDefinitionInput(validInput()) as NodeDefinitionInput;
    expect(sameNodeDefinitionShape(a, b)).toBe(true);
  });

  it("detects a differing shape for the same key+version", () => {
    const a = parseNodeDefinitionInput(validInput()) as NodeDefinitionInput;
    const b = parseNodeDefinitionInput(
      validInput({ presentation: { label: "Different", description: "Different." } }),
    ) as NodeDefinitionInput;
    expect(sameNodeDefinitionShape(a, b)).toBe(false);
  });
});

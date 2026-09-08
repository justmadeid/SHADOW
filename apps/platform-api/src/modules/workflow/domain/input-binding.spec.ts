import { describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/index.js";
import type { NodeField } from "./node-definition.js";
import { validateInputBindings } from "./input-binding.js";

const inputs: NodeField[] = [
  { name: "fullName", type: "STRING", required: true },
  { name: "birthYear", type: "NUMBER", required: false },
];

describe("validateInputBindings", () => {
  it("accepts a well-typed binding set", () => {
    const bindings = validateInputBindings(
      [
        {
          targetInput: "fullName",
          sourceExpression: "person.full_name",
          sourceType: "STRING",
          sourceClassification: "SENSITIVE",
        },
      ],
      inputs,
    );
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.sourceClassification).toBe("SENSITIVE");
  });

  it("rejects a targetInput absent from the NodeDefinition's inputs", () => {
    expect(() =>
      validateInputBindings(
        [
          {
            targetInput: "unknownField",
            sourceExpression: "x",
            sourceType: "STRING",
            sourceClassification: null,
          },
        ],
        inputs,
      ),
    ).toThrow(AppError);
  });

  it("rejects a duplicate targetInput", () => {
    expect(() =>
      validateInputBindings(
        [
          {
            targetInput: "fullName",
            sourceExpression: "a",
            sourceType: "STRING",
            sourceClassification: null,
          },
          {
            targetInput: "fullName",
            sourceExpression: "b",
            sourceType: "STRING",
            sourceClassification: null,
          },
        ],
        inputs,
      ),
    ).toThrow(AppError);
  });

  it("rejects sourceType that does not match the target input's declared type (P3-002 acceptance criterion)", () => {
    expect(() =>
      validateInputBindings(
        [
          {
            targetInput: "fullName",
            sourceExpression: "person.full_name",
            sourceType: "NUMBER",
            sourceClassification: null,
          },
        ],
        inputs,
      ),
    ).toThrow(AppError);
    try {
      validateInputBindings(
        [
          {
            targetInput: "fullName",
            sourceExpression: "person.full_name",
            sourceType: "NUMBER",
            sourceClassification: null,
          },
        ],
        inputs,
      );
    } catch (error) {
      expect((error as AppError).code).toBe("VALIDATION_INPUT_BINDING_INVALID");
    }
  });

  it("rejects an out-of-range sourceExpression length", () => {
    expect(() =>
      validateInputBindings(
        [
          {
            targetInput: "fullName",
            sourceExpression: "",
            sourceType: "STRING",
            sourceClassification: null,
          },
        ],
        inputs,
      ),
    ).toThrow(AppError);
  });
});

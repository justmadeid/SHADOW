import { describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/index.js";
import type { NodeField } from "./node-definition.js";
import {
  archiveNodeInstance,
  assertMutable,
  computeReadiness,
  createNodeInstance,
  nextRevision,
  validateConfigurationAgainstSchema,
} from "./node-instance.js";

const schema: NodeField[] = [
  { name: "timeoutOverride", type: "NUMBER", required: true },
  { name: "strict", type: "BOOLEAN", required: false },
];

describe("validateConfigurationAgainstSchema", () => {
  it("accepts a configuration matching the schema", () => {
    const result = validateConfigurationAgainstSchema(
      { timeoutOverride: 5, strict: true },
      schema,
    );
    expect(result).toEqual({ timeoutOverride: 5, strict: true });
  });

  it("rejects a missing required key", () => {
    expect(() => validateConfigurationAgainstSchema({}, schema)).toThrow(AppError);
  });

  it("rejects an unknown key", () => {
    expect(() =>
      validateConfigurationAgainstSchema({ timeoutOverride: 5, bogus: "x" }, schema),
    ).toThrow(AppError);
  });

  it("rejects a type mismatch", () => {
    expect(() =>
      validateConfigurationAgainstSchema({ timeoutOverride: "five" }, schema),
    ).toThrow(AppError);
  });
});

describe("computeReadiness", () => {
  it("is READY-eligible only when every required input is bound", () => {
    expect(computeReadiness(["a", "b"], ["a"])).toBe(false);
    expect(computeReadiness(["a", "b"], ["a", "b"])).toBe(true);
    expect(computeReadiness([], [])).toBe(true);
  });
});

describe("NodeInstance lifecycle", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const base = {
    id: "0198c000-0000-7000-8000-000000000001",
    workspaceId: "0198c000-0000-7000-8000-000000000002",
    caseId: "0198c000-0000-7000-8000-000000000003",
    investigationId: "0198c000-0000-7000-8000-000000000004",
    nodeDefinitionKey: "person-lookup",
    nodeDefinitionVersion: 1,
    configuration: { timeoutOverride: 5 },
  };

  it("starts DRAFT when required inputs remain unbound", () => {
    const instance = createNodeInstance({ ...base, ready: false }, now);
    expect(instance.status).toBe("DRAFT");
    expect(instance.revision).toBe(1);
  });

  it("starts READY when there are zero required inputs", () => {
    const instance = createNodeInstance({ ...base, ready: true }, now);
    expect(instance.status).toBe("READY");
  });

  it("rejects mutation of an ARCHIVED NodeInstance", () => {
    const instance = createNodeInstance({ ...base, ready: false }, now);
    const archived = archiveNodeInstance(instance, 1, now);
    expect(archived.status).toBe("ARCHIVED");
    expect(() => assertMutable(archived)).toThrow(AppError);
    expect(() =>
      nextRevision(archived, 2, { configuration: { timeoutOverride: 9 } }, now),
    ).toThrow(AppError);
  });

  it("rejects a stale expected revision", () => {
    const instance = createNodeInstance({ ...base, ready: false }, now);
    expect(() =>
      nextRevision(instance, 99, { configuration: { timeoutOverride: 9 } }, now),
    ).toThrow(AppError);
  });
});

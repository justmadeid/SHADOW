import { describe, expect, it } from "vitest";

import {
  assertCaseMutable,
  nextCaseStatus,
  validateCreateCaseInput,
  validateUpdateCaseInput,
} from "./case.js";

describe("Case domain", () => {
  it("normalizes create input without inventing a classification", () => {
    expect(
      validateCreateCaseInput({
        workspaceId: "workspace-id",
        title: "  Missing Person  ",
        description: "  Initial assessment  ",
        classification: "SENSITIVE",
      }),
    ).toEqual({
      workspaceId: "workspace-id",
      title: "Missing Person",
      description: "Initial assessment",
      classification: "SENSITIVE",
    });
  });

  it.each([
    ["short title", { title: "x" }],
    ["long description", { description: "x".repeat(4_001) }],
    ["invalid classification", { classification: "SECRET" }],
  ])("rejects %s", (_label, override) => {
    expect(() =>
      validateCreateCaseInput({
        workspaceId: "workspace-id",
        title: "Missing Person",
        classification: "INTERNAL",
        ...override,
      } as never),
    ).toThrow();
  });

  it("rejects empty updates", () => {
    expect(() => validateUpdateCaseInput({})).toThrow();
  });

  it("supports close, reopen, and terminal archive transitions", () => {
    expect(nextCaseStatus("DRAFT", "CLOSE")).toBe("CLOSED");
    expect(nextCaseStatus("ACTIVE", "CLOSE")).toBe("CLOSED");
    expect(nextCaseStatus("CLOSED", "REOPEN")).toBe("ACTIVE");
    expect(nextCaseStatus("ACTIVE", "ARCHIVE")).toBe("ARCHIVED");
    expect(() => nextCaseStatus("ARCHIVED", "REOPEN")).toThrow();
  });

  it("prevents metadata changes while closed or archived", () => {
    expect(() => assertCaseMutable("CLOSED")).toThrow();
    expect(() => assertCaseMutable("ARCHIVED")).toThrow();
    expect(() => assertCaseMutable("ACTIVE")).not.toThrow();
  });
});

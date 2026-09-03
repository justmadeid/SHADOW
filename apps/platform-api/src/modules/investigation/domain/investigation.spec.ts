import { describe, expect, it } from "vitest";

import {
  assertInvestigationUpdateAllowed,
  validateCreateInvestigationInput,
  validateUpdateInvestigationInput,
} from "./investigation.js";

describe("Investigation domain", () => {
  it("normalizes a branch title and objective", () => {
    expect(
      validateCreateInvestigationInput({
        title: "  Financial trail  ",
        objective: "  Establish beneficial ownership  ",
      }),
    ).toEqual({
      title: "Financial trail",
      objective: "Establish beneficial ownership",
    });
  });

  it.each([
    [{ title: "x", objective: "Valid objective" }],
    [{ title: "Valid title", objective: "x" }],
  ])("rejects invalid create input", (input) => {
    expect(() => validateCreateInvestigationInput(input)).toThrow();
  });

  it("rejects empty updates", () => {
    expect(() => validateUpdateInvestigationInput({})).toThrow();
  });

  it("allows pause, resume, complete, reopen, and archive", () => {
    expect(() => assertInvestigationUpdateAllowed("ACTIVE", "PAUSED")).not.toThrow();
    expect(() => assertInvestigationUpdateAllowed("PAUSED", "ACTIVE")).not.toThrow();
    expect(() => assertInvestigationUpdateAllowed("ACTIVE", "COMPLETED")).not.toThrow();
    expect(() => assertInvestigationUpdateAllowed("COMPLETED", "ACTIVE")).not.toThrow();
    expect(() => assertInvestigationUpdateAllowed("COMPLETED", "ARCHIVED")).not.toThrow();
  });

  it("makes archived Investigation state terminal and immutable", () => {
    expect(() => assertInvestigationUpdateAllowed("ARCHIVED", "ACTIVE")).toThrow();
    expect(() => assertInvestigationUpdateAllowed("ARCHIVED", undefined)).toThrow();
  });
});

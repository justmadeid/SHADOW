import { describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/index.js";
import { assertValidEdgeCandidate, createsCycle } from "./workflow-edge.js";

describe("assertValidEdgeCandidate", () => {
  it("rejects a self-loop", () => {
    expect(() => assertValidEdgeCandidate("a", "a", [])).toThrow(AppError);
  });

  it("rejects a duplicate edge", () => {
    expect(() =>
      assertValidEdgeCandidate("a", "b", [
        { fromNodeInstanceId: "a", toNodeInstanceId: "b" },
      ]),
    ).toThrow(AppError);
  });

  it("rejects an edge that would create a cycle", () => {
    const existing = [
      { fromNodeInstanceId: "a", toNodeInstanceId: "b" },
      { fromNodeInstanceId: "b", toNodeInstanceId: "c" },
    ];
    expect(() => assertValidEdgeCandidate("c", "a", existing)).toThrow(AppError);
  });

  it("accepts a valid non-cyclic edge", () => {
    const existing = [{ fromNodeInstanceId: "a", toNodeInstanceId: "b" }];
    expect(() => assertValidEdgeCandidate("b", "c", existing)).not.toThrow();
  });
});

describe("createsCycle", () => {
  it("detects a direct cycle", () => {
    expect(
      createsCycle("a", "b", [{ fromNodeInstanceId: "b", toNodeInstanceId: "a" }]),
    ).toBe(true);
  });

  it("detects an indirect cycle across multiple hops", () => {
    const existing = [
      { fromNodeInstanceId: "a", toNodeInstanceId: "b" },
      { fromNodeInstanceId: "b", toNodeInstanceId: "c" },
      { fromNodeInstanceId: "c", toNodeInstanceId: "d" },
    ];
    expect(createsCycle("d", "a", existing)).toBe(true);
  });

  it("allows a diamond shape with no cycle", () => {
    const existing = [
      { fromNodeInstanceId: "a", toNodeInstanceId: "b" },
      { fromNodeInstanceId: "a", toNodeInstanceId: "c" },
    ];
    expect(createsCycle("b", "d", existing)).toBe(false);
    expect(createsCycle("c", "d", existing)).toBe(false);
  });
});

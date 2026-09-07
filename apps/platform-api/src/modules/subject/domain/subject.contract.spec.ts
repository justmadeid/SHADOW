import { describe, expect, it } from "vitest";
import { createSubject } from "./investigation-subject.js";
import { parseCreateSubject, parseUpdateSubject } from "./subject-input.js";

describe("Subject public contract", () => {
  it("accepts only explicit creation fields with a nullable Investigation reference", () => {
    expect(parseCreateSubject({ subjectType: "UNKNOWN", role: "UNKNOWN" })).toEqual({
      subjectType: "UNKNOWN",
      role: "UNKNOWN",
      investigationId: null,
    });
    expect(() =>
      parseCreateSubject({ subjectType: "PERSON", role: "WITNESS", entityRef: null }),
    ).toThrow();
    expect(() =>
      parseCreateSubject({ subjectType: "PERSON", role: "WITNESS", seed: {} }),
    ).toThrow();
  });
  it("exposes exactly role change OR archive, not arbitrary lifecycle or scope changes", () => {
    expect(parseUpdateSubject({ role: "WITNESS" })).toEqual({ role: "WITNESS" });
    expect(parseUpdateSubject({ status: "ARCHIVED" })).toEqual({ status: "ARCHIVED" });
    for (const body of [
      {},
      { role: "WITNESS", status: "ARCHIVED" },
      { status: "RESOLVED" },
      { status: "RESOLVING" },
      { workspaceId: "scope" },
      { entityRef: null },
    ])
      expect(() => parseUpdateSubject(body)).toThrow();
  });
  it("serializes reference-only metadata and UTC strings without seed or private actor data", () => {
    const value = createSubject(
      {
        id: "01900000-0000-7000-8000-000000000001",
        workspaceId: "01900000-0000-7000-8000-000000000002",
        caseId: "01900000-0000-7000-8000-000000000003",
        role: "UNKNOWN",
        subjectType: "UNKNOWN",
      },
      new Date("2026-09-07T00:00:00Z"),
    );
    expect(Object.keys(JSON.parse(JSON.stringify(value))).sort()).toEqual(
      [
        "id",
        "workspaceId",
        "caseId",
        "investigationId",
        "subjectType",
        "role",
        "status",
        "entityRef",
        "revision",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
    expect(value.entityRef).toBeNull();
    expect(value.createdAt).toBe("2026-09-07T00:00:00.000Z");
  });
});

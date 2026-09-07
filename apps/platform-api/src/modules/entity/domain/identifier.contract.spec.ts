import { describe, expect, it } from "vitest";
import { parseCreateIdentifier } from "./identifier-input.js";
import { maskedIdentifier } from "./identifier.js";

describe("Identifier public contract", () => {
  it("normalizes controlled identifier types without creating a plain digest", () => {
    expect(
      parseCreateIdentifier({
        type: "NATIONAL_ID",
        value: "3201 0101-0101 0001",
        classification: "RESTRICTED",
      }),
    ).toEqual({
      type: "NATIONAL_ID",
      value: "3201010101010001",
      classification: "RESTRICTED",
    });
    expect(
      parseCreateIdentifier({
        type: "EMAIL",
        value: "Synthetic.Person@Example.Test",
        classification: "SENSITIVE",
      }).value,
    ).toBe("synthetic.person@example.test");
    expect(
      parseCreateIdentifier({
        type: "PHONE",
        value: "+62 812-3456-7890",
        classification: "SENSITIVE",
      }).value,
    ).toBe("+6281234567890");
  });

  it("rejects unknown fields, invalid canonical values and oversized input", () => {
    for (const input of [
      { type: "NATIONAL_ID", value: "123", classification: "RESTRICTED" },
      { type: "PHONE", value: "081234", classification: "SENSITIVE" },
      { type: "EMAIL", value: "not-email", classification: "SENSITIVE" },
      { type: "UNKNOWN", value: "synthetic", classification: "RESTRICTED" },
      { type: "USERNAME", value: "user\nname", classification: "SENSITIVE" },
      { type: "USERNAME", value: "x".repeat(321), classification: "SENSITIVE" },
      {
        type: "USERNAME",
        value: "synthetic",
        classification: "SENSITIVE",
        fingerprint: "caller-controlled",
      },
    ])
      expect(() => parseCreateIdentifier(input)).toThrowError(
        expect.objectContaining({ code: "VALIDATION_IDENTIFIER_INVALID" }),
      );
  });

  it("uses a fixed mask without preserving value length or fragments", () => {
    const view = maskedIdentifier({
      id: "01900000-0000-7000-8000-000000000001",
      entityId: "01900000-0000-7000-8000-000000000002",
      workspaceId: "01900000-0000-7000-8000-000000000003",
      type: "NATIONAL_ID",
      classification: "RESTRICTED",
      status: "ACTIVE",
      revision: 1,
      createdAt: "2026-09-07T00:00:00.000Z",
      updatedAt: "2026-09-07T00:00:00.000Z",
    });
    expect(view).toMatchObject({ visibility: "MASKED", displayValue: "••••" });
    expect(JSON.stringify(view)).not.toContain("value");
  });
});

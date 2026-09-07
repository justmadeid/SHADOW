import { describe, expect, it } from "vitest";
import {
  buildSubjectSeed,
  validateSubjectSeed,
  type ProvenanceRef,
  type SubjectSeedFieldInput,
} from "./subject-seed.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const caseId = "01900000-0000-7000-8000-000000000002";
const evidenceId = "01900000-0000-7000-8000-000000000003";
const base: SubjectSeedFieldInput = {
  name: "DISPLAY_NAME",
  value: "  Synthetic Person  ",
  origin: "INVESTIGATOR_INPUT",
  classification: "INTERNAL",
};
const scope = { workspaceId, caseId, subjectType: "PERSON" as const };
const ref = (
  type: "EVIDENCE" | "SOURCE_RECORD",
  id = evidenceId,
  workspace = workspaceId,
  caseScope = caseId,
): ProvenanceRef => ({ type, id, workspaceId: workspace, caseId: caseScope });

describe("SubjectSeed domain", () => {
  it("normalizes a bounded, typed investigator field", () => {
    const [field] = validateSubjectSeed([base], scope);
    expect(field).toEqual({
      ...base,
      value: "Synthetic Person",
      evidenceRef: null,
      sourceRecordRef: null,
    });
    expect(Object.isFrozen(field)).toBe(true);
  });

  it("normalizes domain and secure social URL values", () => {
    expect(
      validateSubjectSeed(
        [
          { ...base, name: "DOMAIN_NAME", value: "EXAMPLE.TEST" },
          {
            ...base,
            name: "SOCIAL_PROFILE_URL",
            value: "https://social.example/profile/test",
          },
        ],
        { ...scope, subjectType: "ORGANIZATION" },
      ).map((field) => field.value),
    ).toEqual(["example.test", "https://social.example/profile/test"]);
    for (const value of [
      "http://social.example/profile/test",
      "https://user:pass@social.example/test",
      "https://social.example/test#secret",
      `https://social.example/${"é".repeat(600)}`,
      "not-a-url",
    ])
      expect(() =>
        validateSubjectSeed([{ ...base, name: "SOCIAL_PROFILE_URL", value }], scope),
      ).toThrow();
  });

  it("requires the exact reference shape implied by each provenance origin", () => {
    expect(
      validateSubjectSeed(
        [
          { ...base, origin: "EVIDENCE", evidenceRef: ref("EVIDENCE") },
          {
            ...base,
            name: "USERNAME",
            value: "synthetic_user",
            origin: "SOURCE_RECORD",
            sourceRecordRef: ref("SOURCE_RECORD"),
          },
        ],
        scope,
      ),
    ).toHaveLength(2);
    for (const field of [
      { ...base, origin: "EVIDENCE" },
      { ...base, evidenceRef: ref("EVIDENCE") },
      { ...base, origin: "SOURCE_RECORD", evidenceRef: ref("EVIDENCE") },
      {
        ...base,
        origin: "INVESTIGATOR_INPUT",
        sourceRecordRef: ref("SOURCE_RECORD"),
      },
    ] as SubjectSeedFieldInput[])
      expect(() => validateSubjectSeed([field], scope)).toThrow();
  });

  it("rejects cross-scope, wrong-type and decorated references", () => {
    for (const evidenceRef of [
      ref("EVIDENCE", evidenceId, "01900000-0000-7000-8000-000000000009"),
      ref("EVIDENCE", evidenceId, workspaceId, "01900000-0000-7000-8000-000000000009"),
      ref("SOURCE_RECORD"),
      { ...ref("EVIDENCE"), extra: "untrusted" },
    ])
      expect(() =>
        validateSubjectSeed(
          [{ ...base, origin: "EVIDENCE", evidenceRef } as SubjectSeedFieldInput],
          scope,
        ),
      ).toThrow();
  });

  it("enforces Subject compatibility, uniqueness and bounds", () => {
    expect(() =>
      validateSubjectSeed(
        [{ ...base, name: "DOMAIN_NAME", value: "example.test" }],
        scope,
      ),
    ).toThrow();
    expect(() => validateSubjectSeed([base, base], scope)).toThrow();
    expect(() => validateSubjectSeed([], scope)).toThrow();
    expect(() =>
      validateSubjectSeed(
        Array.from({ length: 21 }, () => base),
        scope,
      ),
    ).toThrow();
  });

  it("fails closed for restricted values until protected storage exists", () => {
    expect(() =>
      validateSubjectSeed([{ ...base, classification: "RESTRICTED" }], scope),
    ).toThrow(
      expect.objectContaining({ code: "SUBJECT_SEED_RESTRICTED_STORAGE_UNAVAILABLE" }),
    );
  });

  it("builds deeply immutable seed snapshots with stable field order", () => {
    const seed = buildSubjectSeed(
      {
        id: "01900000-0000-7000-8000-000000000004",
        subjectId: "01900000-0000-7000-8000-000000000005",
        workspaceId,
        caseId,
        subjectType: "PERSON",
        fields: [
          { ...base, id: "01900000-0000-7000-8000-000000000006" },
          {
            ...base,
            id: "01900000-0000-7000-8000-000000000007",
            name: "USERNAME",
            value: "synthetic_user",
          },
        ],
      },
      new Date("2026-09-07T00:00:00Z"),
    );
    expect(seed.fields.map((field) => field.ordinal)).toEqual([0, 1]);
    expect(Object.isFrozen(seed)).toBe(true);
    expect(Object.isFrozen(seed.fields)).toBe(true);
    expect(Object.isFrozen(seed.fields[0])).toBe(true);
  });
});

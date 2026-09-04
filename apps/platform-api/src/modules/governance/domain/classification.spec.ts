import { describe, expect, it } from "vitest";
import { DATA_CLASSIFICATIONS, type DataClassification } from "@intelligence/contracts";
import {
  assertClassification,
  classificationHandling,
  deriveClassification,
  presentClassifiedField,
} from "./classification.js";

describe("Classification primitives", () => {
  it.each(DATA_CLASSIFICATIONS)(
    "returns explicit handling obligations for %s",
    (classification) => {
      expect(classificationHandling(classification)).toMatchObject({
        classification,
        policyVersion: 1,
        applicationLogs: "METADATA_ONLY",
        metricsLabels: "NO_CONTENT",
      });
    },
  );
  it("minimizes restricted handling without mutating shared defaults", () => {
    const handling = classificationHandling("RESTRICTED");
    expect(handling).toMatchObject({
      identifierDefaultVisibility: "MASKED",
      queuePayload: "REFERENCES_ONLY",
      searchProjection: "NO_RAW_VALUES",
      rawPersistence: "DISABLED_BY_DEFAULT",
      export: "REDACTED_ONLY",
      workerRouting: "RESTRICTED",
      retention: "EXPLICIT_MINIMIZED",
      crossCaseDisclosure: "DENY_BY_DEFAULT",
    });
    handling.rawPersistence = "SOURCE_POLICY";
    expect(classificationHandling("RESTRICTED").rawPersistence).toBe(
      "DISABLED_BY_DEFAULT",
    );
  });
  it.each([undefined, null, "SECRET", "restricted", 0, {}])(
    "rejects invalid classification %# without echoing its value",
    (value) => {
      expect(() => assertClassification(value)).toThrow(
        expect.objectContaining({
          code: "GOVERNANCE_CLASSIFICATION_INVALID",
          details: undefined,
        }),
      );
    },
  );
  it("takes the maximum input sensitivity at every derivation stage", () => {
    for (const a of DATA_CLASSIFICATIONS)
      for (const b of DATA_CLASSIFICATIONS) {
        const expected =
          DATA_CLASSIFICATIONS[
            Math.max(DATA_CLASSIFICATIONS.indexOf(a), DATA_CLASSIFICATIONS.indexOf(b))
          ];
        expect(deriveClassification([a, b])).toBe(expected);
        expect(deriveClassification([b, a])).toBe(expected);
      }
    let stage: DataClassification = "RESTRICTED";
    for (let i = 0; i < 7; i++) stage = deriveClassification([stage, "PUBLIC"]);
    expect(stage).toBe("RESTRICTED");
    expect(deriveClassification(["PUBLIC"], "SENSITIVE")).toBe("SENSITIVE");
  });
  it("rejects downgrade and missing classification inputs", () => {
    expect(() => deriveClassification(["RESTRICTED"], "PUBLIC")).toThrow(
      expect.objectContaining({ code: "GOVERNANCE_CLASSIFICATION_DOWNGRADE_DENIED" }),
    );
    expect(() => deriveClassification([])).toThrow();
    expect(() => deriveClassification(["SECRET" as DataClassification])).toThrow();
  });
  it.each(["1", "1234567890123456", "<script>synthetic</script>"])(
    "masks without disclosing value, length, or supplied match status %#",
    (value) => {
      expect(
        presentClassifiedField(
          { classification: "RESTRICTED", visibility: "MASKED" },
          { value, matchStatus: "EXACT_MATCH" },
        ),
      ).toEqual({
        classification: "RESTRICTED",
        visibility: "MASKED",
        displayValue: "••••",
      });
    },
  );
  it("match-only and hidden views omit raw values and unexpected fields", () => {
    const field = {
      value: "synthetic-secret",
      matchStatus: "EXACT_MATCH" as const,
      extra: "untrusted",
    };
    expect(
      presentClassifiedField(
        { classification: "SENSITIVE", visibility: "MATCH_ONLY" },
        field,
      ),
    ).toEqual({
      classification: "SENSITIVE",
      visibility: "MATCH_ONLY",
      matchStatus: "EXACT_MATCH",
    });
    expect(
      presentClassifiedField(
        { classification: "SENSITIVE", visibility: "HIDDEN" },
        field,
      ),
    ).toEqual({ classification: "SENSITIVE", visibility: "HIDDEN" });
  });
  it("does not read value at all for non-full visibility", () => {
    const field = {
      get value(): string {
        throw new Error("raw value accessed");
      },
    };
    for (const visibility of ["MASKED", "MATCH_ONLY", "HIDDEN"] as const)
      expect(() =>
        presentClassifiedField({ classification: "RESTRICTED", visibility }, field),
      ).not.toThrow();
  });
  it("full view is explicit and does not mark source content as trusted HTML", () => {
    expect(
      presentClassifiedField(
        { classification: "PUBLIC", visibility: "FULL" },
        { value: "<script>synthetic</script>" },
      ),
    ).toEqual({
      classification: "PUBLIC",
      visibility: "FULL",
      displayValue: "<script>synthetic</script>",
    });
    expect(() =>
      presentClassifiedField({ classification: "PUBLIC", visibility: "FULL" }, {}),
    ).toThrow();
  });
});

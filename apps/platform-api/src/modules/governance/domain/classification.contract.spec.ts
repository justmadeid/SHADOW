import { describe, expect, it } from "vitest";
import { DATA_CLASSIFICATIONS, FIELD_VISIBILITIES } from "@intelligence/contracts";
import { classificationHandling, presentClassifiedField } from "./classification.js";

describe("P1-007 classification wire contract", () => {
  it("preserves locked classification and visibility vocabulary", () => {
    expect(DATA_CLASSIFICATIONS).toEqual([
      "PUBLIC",
      "INTERNAL",
      "SENSITIVE",
      "RESTRICTED",
    ]);
    expect(FIELD_VISIBILITIES).toEqual(["FULL", "MASKED", "MATCH_ONLY", "HIDDEN"]);
  });
  it("serializes only the discriminant-appropriate field keys", () => {
    const expectedKeys = {
      FULL: ["classification", "displayValue", "visibility"],
      MASKED: ["classification", "displayValue", "visibility"],
      MATCH_ONLY: ["classification", "matchStatus", "visibility"],
      HIDDEN: ["classification", "visibility"],
    };
    for (const visibility of FIELD_VISIBILITIES) {
      const view = presentClassifiedField(
        { classification: "RESTRICTED", visibility },
        { value: "synthetic-identifier", matchStatus: "EXACT_MATCH" },
      );
      expect(Object.keys(JSON.parse(JSON.stringify(view))).sort()).toEqual(
        expectedKeys[visibility],
      );
      if (visibility !== "FULL")
        expect(JSON.stringify(view)).not.toContain("synthetic-identifier");
    }
  });
  it("returns versioned handling metadata without identity, reason, or source values", () => {
    for (const classification of DATA_CLASSIFICATIONS) {
      const handling = classificationHandling(classification);
      expect(Object.keys(handling).sort()).toEqual(
        [
          "classification",
          "policyVersion",
          "identifierDefaultVisibility",
          "applicationLogs",
          "metricsLabels",
          "queuePayload",
          "searchProjection",
          "rawPersistence",
          "export",
          "workerRouting",
          "retention",
          "objectAccess",
          "crossCaseDisclosure",
        ].sort(),
      );
      expect(handling.policyVersion).toBe(1);
    }
  });
});

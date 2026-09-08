import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("P2-009 Target Profile OpenAPI contract", () => {
  const contract = fs.readFileSync(
    new URL("../../../../../docs/contracts/platform-api-v1.yaml", import.meta.url),
    "utf8",
  );

  it("defines the Case-bound Subject profile query and read model", () => {
    expect(contract).toContain("/shadow/cases/{caseId}/targets/{subjectId}:");
    expect(contract).toContain("operationId: getShadowTargetProfile");
    expect(contract).toContain("TargetProfileView:");
    expect(contract).toContain("TargetProfileFreshness:");
    expect(contract).toContain("NOT_IMPLEMENTED");
  });
});

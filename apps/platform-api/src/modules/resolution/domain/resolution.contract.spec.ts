import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { newUuid } from "../../../platform/ids/uuid.js";
import { createCandidate } from "./candidate.js";
import { createResolutionSession } from "./resolution-session.js";

describe("P2-005 Resolution public contract", () => {
  it("serializes bounded Resolution and non-canonical Candidate fields", () => {
    const scope = {
      workspaceId: newUuid(),
      caseId: newUuid(),
      subjectId: newUuid(),
    };
    const session = createResolutionSession({ id: newUuid(), ...scope }, new Date(0));
    const candidate = createCandidate(
      {
        id: newUuid(),
        resolutionSessionId: session.id,
        ...scope,
        subjectType: "PERSON",
        type: "PERSON",
        displayLabel: "Synthetic",
        classification: "INTERNAL",
        source: { origin: "INVESTIGATOR_INPUT", resource: null },
      },
      new Date(0),
    );
    expect(Object.keys(JSON.parse(JSON.stringify(session))).sort()).toEqual(
      [
        "id",
        "subjectId",
        "workspaceId",
        "caseId",
        "status",
        "candidatesCount",
        "selectedCandidateId",
        "resolutionDecisionId",
        "revision",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
    expect(Object.keys(JSON.parse(JSON.stringify(candidate))).sort()).toEqual(
      [
        "id",
        "resolutionSessionId",
        "subjectId",
        "workspaceId",
        "caseId",
        "type",
        "status",
        "displayLabel",
        "classification",
        "source",
        "evidenceRefs",
        "revision",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
    expect(candidate).not.toHaveProperty("entityId");
    expect(candidate).not.toHaveProperty("decision");
  });

  it("publishes read-only P2-005 paths and reserves mutations for P2-008", () => {
    const contract = fs.readFileSync(
      new URL("../../../../../../docs/contracts/platform-api-v1.yaml", import.meta.url),
      "utf8",
    );
    expect(contract).toContain("/resolutions/{resolutionId}:");
    expect(contract).toContain("/resolutions/{resolutionId}/candidates:");
    expect(contract).toContain("/candidates/{candidateId}:");
    expect(contract).not.toContain("/candidates/{candidateId}/actions/resolve:");
    expect(contract).not.toContain("/subjects/{subjectId}/actions/start-resolution:");
  });
});

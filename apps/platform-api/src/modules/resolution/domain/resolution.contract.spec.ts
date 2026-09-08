import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { newUuid } from "../../../platform/ids/uuid.js";
import { createCandidate } from "./candidate.js";
import {
  createEntityMatch,
  presentEntityMatch,
  presentEntityMatchView,
} from "./matching-signal.js";
import { createResolutionSession } from "./resolution-session.js";

describe("P2-005 through P2-008 Resolution public contract", () => {
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

  it("publishes the P2-008 atomic mutation paths", () => {
    const contract = fs.readFileSync(
      new URL("../../../../../../docs/contracts/platform-api-v1.yaml", import.meta.url),
      "utf8",
    );
    expect(contract).toContain("/resolutions/{resolutionId}:");
    expect(contract).toContain("/resolutions/{resolutionId}/candidates:");
    expect(contract).toContain("/candidates/{candidateId}:");
    expect(contract).toContain("/candidates/{candidateId}/actions/resolve:");
    expect(contract).toContain("/subjects/{subjectId}/actions/start-resolution:");
    expect(contract).toContain("/subjects/{subjectId}/resolution:");
  });

  it("serializes P2-006 explanations without values, fingerprints, or scores", () => {
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
        displayLabel: null,
        classification: "RESTRICTED",
        source: { origin: "INVESTIGATOR_INPUT", resource: null },
      },
      new Date(0),
    );
    const match = createEntityMatch(
      {
        id: newUuid(),
        candidate,
        entity: {
          id: newUuid(),
          workspaceId: scope.workspaceId,
          type: "PERSON",
          revision: 2,
        },
        matchLevel: "VERY_HIGH",
        signals: [
          {
            id: newUuid(),
            kind: "MATCHING",
            field: "NATIONAL_ID",
            result: "EXACT_MATCH",
            strength: "STRONG",
            classification: "RESTRICTED",
            valueVisibility: "MATCH_ONLY",
          },
        ],
      },
      new Date(0),
    );
    const wire = JSON.stringify(presentEntityMatch(match, true));
    expect(wire).toContain("EXACT_MATCH");
    expect(wire).not.toContain("displayValue");
    expect(wire).not.toContain("fingerprint");
    expect(wire).not.toContain("score");

    const contract = fs.readFileSync(
      new URL("../../../../../../docs/contracts/platform-api-v1.yaml", import.meta.url),
      "utf8",
    );
    expect(contract).toContain("enum: [PUBLIC, INTERNAL, SENSITIVE, RESTRICTED]");
    expect(contract).toContain('fixed displayLabel "Restricted candidate"');
    expect(contract).toContain("/resolutions/{resolutionId}/matches:");
    expect(contract).toContain("operationId: listResolutionEntityMatches");
    const view = presentEntityMatchView(match, {
      canDiscoverEntity: true,
      canUseProtectedSignals: true,
      canViewCrossCaseContext: false,
    });
    expect(Object.keys(JSON.parse(JSON.stringify(view))).sort()).toEqual(
      [
        "id",
        "candidateId",
        "entityRef",
        "matchLevel",
        "signals",
        "conflicts",
        "crossCaseContext",
        "createdAt",
      ].sort(),
    );
    expect(JSON.stringify(view)).not.toContain("classification");
  });
});

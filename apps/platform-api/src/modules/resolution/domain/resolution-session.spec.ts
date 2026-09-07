import { describe, expect, it } from "vitest";
import { newUuid } from "../../../platform/ids/uuid.js";
import { createCandidate, decideCandidate } from "./candidate.js";
import {
  closeEmptyResolutionSession,
  createResolutionSession,
  recordResolutionDecision,
  registerCandidate,
} from "./resolution-session.js";

const now = new Date("2026-09-07T12:00:00Z");

describe("P2-005 ResolutionSession", () => {
  it("moves SEARCHING to NEEDS_REVIEW when a scoped Candidate arrives", () => {
    const session = createResolutionSession(
      {
        id: newUuid(),
        subjectId: newUuid(),
        workspaceId: newUuid(),
        caseId: newUuid(),
      },
      now,
    );
    const candidate = createCandidate(
      {
        id: newUuid(),
        resolutionSessionId: session.id,
        subjectId: session.subjectId,
        workspaceId: session.workspaceId,
        caseId: session.caseId,
        subjectType: "PERSON",
        type: "PERSON",
        displayLabel: "Synthetic",
        classification: "INTERNAL",
        source: { origin: "INVESTIGATOR_INPUT", resource: null },
      },
      now,
    );
    expect(registerCandidate(session, candidate, 1, now)).toMatchObject({
      status: "NEEDS_REVIEW",
      candidatesCount: 1,
      revision: 2,
    });
  });

  it("closes an empty search without manufacturing a Candidate", () => {
    const session = createResolutionSession(
      {
        id: newUuid(),
        subjectId: newUuid(),
        workspaceId: newUuid(),
        caseId: newUuid(),
      },
      now,
    );
    expect(closeEmptyResolutionSession(session, 1, now)).toMatchObject({
      status: "CLOSED",
      candidatesCount: 0,
    });
  });

  it("finalizes only a conclusive decision and preserves noncanonical outcomes", () => {
    const initial = createResolutionSession(
      {
        id: newUuid(),
        subjectId: newUuid(),
        workspaceId: newUuid(),
        caseId: newUuid(),
      },
      now,
    );
    const candidate = createCandidate(
      {
        id: newUuid(),
        resolutionSessionId: initial.id,
        subjectId: initial.subjectId,
        workspaceId: initial.workspaceId,
        caseId: initial.caseId,
        subjectType: "PERSON",
        type: "PERSON",
        displayLabel: "Synthetic",
        classification: "INTERNAL",
        source: { origin: "INVESTIGATOR_INPUT", resource: null },
      },
      now,
    );
    const withFirstCandidate = registerCandidate(initial, candidate, 1, now);
    const otherCandidate = createCandidate(
      {
        id: newUuid(),
        resolutionSessionId: initial.id,
        subjectId: initial.subjectId,
        workspaceId: initial.workspaceId,
        caseId: initial.caseId,
        subjectType: "PERSON",
        type: "PERSON",
        displayLabel: "Other Synthetic",
        classification: "INTERNAL",
        source: { origin: "INVESTIGATOR_INPUT", resource: null },
      },
      now,
    );
    const session = registerCandidate(withFirstCandidate, otherCandidate, 2, now);
    const rejected = decideCandidate(
      candidate,
      {
        id: newUuid(),
        decision: "REJECT",
        reasonCode: "NOT_SAME_IDENTITY",
        decidedByUserId: "reviewer",
      },
      1,
      now,
    );
    expect(
      recordResolutionDecision(session, rejected.candidate, rejected.decision, 1, 3, now),
    ).toMatchObject({
      status: "NEEDS_REVIEW",
      selectedCandidateId: null,
      resolutionDecisionId: null,
    });
    const resolved = decideCandidate(
      candidate,
      {
        id: newUuid(),
        decision: "CREATE_NEW",
        targetEntityId: newUuid(),
        reasonCode: "MANUAL_REVIEW",
        decidedByUserId: "reviewer",
      },
      1,
      now,
    );
    expect(
      recordResolutionDecision(session, resolved.candidate, resolved.decision, 0, 3, now),
    ).toMatchObject({
      status: "RESOLVED",
      selectedCandidateId: candidate.id,
      resolutionDecisionId: resolved.decision.id,
    });
  });
});

import { describe, expect, it } from "vitest";
import { newUuid } from "../../../platform/ids/uuid.js";
import { createCandidate, decideCandidate } from "./candidate.js";

const now = new Date("2026-09-07T12:00:00Z");
const scope = {
  resolutionSessionId: "01900000-0000-7000-8000-000000000001",
  subjectId: "01900000-0000-7000-8000-000000000002",
  workspaceId: "01900000-0000-7000-8000-000000000003",
  caseId: "01900000-0000-7000-8000-000000000004",
} as const;

describe("P2-005 Candidate", () => {
  it("creates a non-canonical review artifact with scoped provenance", () => {
    const evidenceId = newUuid();
    const candidate = createCandidate(
      {
        ...scope,
        id: newUuid(),
        subjectType: "PERSON",
        type: "PERSON",
        displayLabel: "  Synthetic   Person  ",
        classification: "SENSITIVE",
        source: {
          origin: "EVIDENCE",
          resource: {
            type: "EVIDENCE",
            id: evidenceId,
            workspaceId: scope.workspaceId,
            caseId: scope.caseId,
          },
        },
        evidenceRefs: [
          {
            type: "EVIDENCE",
            id: evidenceId,
            workspaceId: scope.workspaceId,
            caseId: scope.caseId,
          },
        ],
      },
      now,
    );
    expect(candidate).toMatchObject({
      displayLabel: "Synthetic Person",
      status: "PENDING_REVIEW",
      revision: 1,
    });
    expect(candidate).not.toHaveProperty("entityId");
    expect(candidate).not.toHaveProperty("matchScore");
  });

  it("rejects cross-scope, incompatible, duplicate, and raw restricted input", () => {
    const base = {
      ...scope,
      id: newUuid(),
      subjectType: "PERSON" as const,
      type: "PERSON" as const,
      displayLabel: "Synthetic",
      classification: "INTERNAL" as const,
      source: { origin: "INVESTIGATOR_INPUT" as const, resource: null },
    };
    expect(() => createCandidate({ ...base, type: "DOMAIN" }, now)).toThrow("compatible");
    expect(() =>
      createCandidate({ ...base, classification: "RESTRICTED" }, now),
    ).toThrow();
    expect(
      createCandidate({ ...base, classification: "RESTRICTED", displayLabel: null }, now),
    ).toMatchObject({
      classification: "RESTRICTED",
      displayLabel: "Restricted candidate",
    });
    const ref = {
      type: "EVIDENCE" as const,
      id: newUuid(),
      workspaceId: newUuid(),
      caseId: scope.caseId,
    };
    expect(() =>
      createCandidate(
        {
          ...base,
          source: { origin: "EVIDENCE", resource: ref },
        },
        now,
      ),
    ).toThrow();
    const evidence = { ...ref, workspaceId: scope.workspaceId };
    expect(() =>
      createCandidate({ ...base, evidenceRefs: [evidence, evidence] }, now),
    ).toThrow();
  });

  it("records one controlled decision without creating an Entity", () => {
    const candidate = createCandidate(
      {
        ...scope,
        id: newUuid(),
        subjectType: "UNKNOWN",
        type: "ORGANIZATION",
        displayLabel: "Synthetic Organization",
        classification: "INTERNAL",
        source: { origin: "INVESTIGATOR_INPUT", resource: null },
      },
      now,
    );
    const result = decideCandidate(
      candidate,
      {
        id: newUuid(),
        decision: "LINK_EXISTING",
        targetEntityId: newUuid(),
        reasonCode: "MULTIPLE_SUPPORTING_SIGNALS",
        decidedByUserId: "reviewer",
      },
      1,
      new Date("2026-09-07T12:01:00Z"),
    );
    expect(result.candidate).toMatchObject({ status: "RESOLVED", revision: 2 });
    expect(result.decision.decision).toBe("LINK_EXISTING");
    expect(result.candidate).not.toHaveProperty("entityId");
    expect(() =>
      decideCandidate(
        result.candidate,
        {
          id: newUuid(),
          decision: "REJECT",
          reasonCode: "NOT_SAME_IDENTITY",
          decidedByUserId: "reviewer",
        },
        2,
        now,
      ),
    ).toThrow("already");
  });

  it("requires an Entity only for conclusive decisions", () => {
    const candidate = createCandidate(
      {
        ...scope,
        id: newUuid(),
        subjectType: "PERSON",
        type: "PERSON",
        displayLabel: "Synthetic",
        classification: "PUBLIC",
        source: { origin: "INVESTIGATOR_INPUT", resource: null },
      },
      now,
    );
    expect(() =>
      decideCandidate(
        candidate,
        {
          id: newUuid(),
          decision: "CREATE_NEW",
          reasonCode: "MANUAL_REVIEW",
          decidedByUserId: "reviewer",
        },
        1,
        now,
      ),
    ).toThrow();
    expect(() =>
      decideCandidate(
        candidate,
        {
          id: newUuid(),
          decision: "REJECT",
          targetEntityId: newUuid(),
          reasonCode: "NOT_SAME_IDENTITY",
          decidedByUserId: "reviewer",
        },
        1,
        now,
      ),
    ).toThrow();
  });
});

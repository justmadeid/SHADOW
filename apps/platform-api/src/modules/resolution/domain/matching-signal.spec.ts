import { describe, expect, it } from "vitest";
import { newUuid } from "../../../platform/ids/uuid.js";
import { createCandidate } from "./candidate.js";
import {
  createEntityMatch,
  presentEntityMatch,
  presentEntityMatchView,
} from "./matching-signal.js";

const scope = {
  resolutionSessionId: "01900000-0000-7000-8000-000000000001",
  subjectId: "01900000-0000-7000-8000-000000000002",
  workspaceId: "01900000-0000-7000-8000-000000000003",
  caseId: "01900000-0000-7000-8000-000000000004",
} as const;
const now = new Date("2026-09-08T01:00:00Z");

function candidate() {
  return createCandidate(
    {
      ...scope,
      id: newUuid(),
      subjectType: "PERSON",
      type: "PERSON",
      displayLabel: "Synthetic Person",
      classification: "INTERNAL",
      source: { origin: "INVESTIGATOR_INPUT", resource: null },
    },
    now,
  );
}

describe("P2-006 MatchingSignal and ConflictSignal", () => {
  it("keeps explainable supporting and contradicting signals without a score", () => {
    const value = createEntityMatch(
      {
        id: newUuid(),
        candidate: candidate(),
        entity: {
          id: newUuid(),
          workspaceId: scope.workspaceId,
          type: "PERSON",
          revision: 4,
        },
        matchLevel: "MEDIUM",
        signals: [
          {
            id: newUuid(),
            kind: "MATCHING",
            field: "NAME",
            result: "PARTIAL_MATCH",
            strength: "SUPPORTING",
            classification: "INTERNAL",
            valueVisibility: "FULL",
          },
          {
            id: newUuid(),
            kind: "CONFLICT",
            field: "DATE_OF_BIRTH",
            result: "CONFLICT",
            strength: "CONTRADICTING",
            classification: "SENSITIVE",
            valueVisibility: "MATCH_ONLY",
          },
        ],
      },
      now,
    );

    expect(value.signals).toHaveLength(1);
    expect(value.conflicts).toHaveLength(1);
    expect(value).not.toHaveProperty("score");
    expect(JSON.stringify(value)).not.toContain("displayValue");
    expect(JSON.stringify(value)).not.toContain("fingerprint");
  });

  it("allows RESTRICTED results only as MATCH_ONLY or HIDDEN metadata", () => {
    const base = {
      id: newUuid(),
      candidate: candidate(),
      entity: {
        id: newUuid(),
        workspaceId: scope.workspaceId,
        type: "PERSON" as const,
        revision: 1,
      },
      matchLevel: "VERY_HIGH" as const,
    };
    expect(() =>
      createEntityMatch(
        {
          ...base,
          signals: [
            {
              id: newUuid(),
              kind: "MATCHING",
              field: "NATIONAL_ID",
              result: "EXACT_MATCH",
              strength: "STRONG",
              classification: "RESTRICTED",
              valueVisibility: "FULL",
            },
          ],
        },
        now,
      ),
    ).toThrow();

    const safe = createEntityMatch(
      {
        ...base,
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
      now,
    );
    expect(safe.signals[0]).toMatchObject({
      field: "NATIONAL_ID",
      result: "EXACT_MATCH",
      valueVisibility: "MATCH_ONLY",
    });
    expect(safe.signals[0]).not.toHaveProperty("displayValue");
  });

  it("filters HIDDEN signals and fails closed without Entity discovery", () => {
    const value = createEntityMatch(
      {
        id: newUuid(),
        candidate: candidate(),
        entity: {
          id: newUuid(),
          workspaceId: scope.workspaceId,
          type: "PERSON",
          revision: 1,
        },
        matchLevel: "MEDIUM",
        signals: [
          {
            id: newUuid(),
            kind: "MATCHING",
            field: "EMAIL",
            result: "EXACT_MATCH",
            strength: "SUPPORTING",
            classification: "RESTRICTED",
            valueVisibility: "HIDDEN",
          },
          {
            id: newUuid(),
            kind: "MATCHING",
            field: "NAME",
            result: "PARTIAL_MATCH",
            strength: "WEAK",
            classification: "INTERNAL",
            valueVisibility: "FULL",
          },
        ],
      },
      now,
    );
    expect(presentEntityMatch(value, false)).toBeNull();
    const presented = presentEntityMatch(value, true);
    expect(presented?.signals).toHaveLength(1);
    expect(presented?.signals[0]?.field).toBe("NAME");
  });

  it("projects existence-only views and independently gates protected signals", () => {
    const value = createEntityMatch(
      {
        id: newUuid(),
        candidate: candidate(),
        entity: {
          id: newUuid(),
          workspaceId: scope.workspaceId,
          type: "PERSON",
          revision: 1,
        },
        matchLevel: "HIGH",
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
          {
            id: newUuid(),
            kind: "MATCHING",
            field: "NAME",
            result: "PARTIAL_MATCH",
            strength: "SUPPORTING",
            classification: "INTERNAL",
            valueVisibility: "FULL",
          },
        ],
      },
      now,
    );
    const existenceOnly = presentEntityMatchView(value, {
      canDiscoverEntity: true,
      canUseProtectedSignals: false,
      canViewCrossCaseContext: false,
    });
    expect(existenceOnly).toMatchObject({
      signals: [{ field: "NAME" }],
      crossCaseContext: { exists: true, detailsVisible: false },
    });
    expect(existenceOnly?.signals[0]).not.toHaveProperty("classification");
    expect(existenceOnly).not.toHaveProperty("workspaceId");
    expect(
      presentEntityMatchView(value, {
        canDiscoverEntity: false,
        canUseProtectedSignals: true,
        canViewCrossCaseContext: true,
      }),
    ).toBeNull();
  });

  it("rejects cross-Workspace, incompatible Entity, and invalid signal semantics", () => {
    const base = {
      id: newUuid(),
      candidate: candidate(),
      matchLevel: "LOW" as const,
      signals: [
        {
          id: newUuid(),
          kind: "MATCHING" as const,
          field: "NAME" as const,
          result: "EXACT_MATCH" as const,
          strength: "STRONG" as const,
          classification: "INTERNAL" as const,
          valueVisibility: "FULL" as const,
        },
      ],
    };
    expect(() =>
      createEntityMatch(
        {
          ...base,
          entity: {
            id: newUuid(),
            workspaceId: newUuid(),
            type: "PERSON",
            revision: 1,
          },
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      createEntityMatch(
        {
          ...base,
          entity: {
            id: newUuid(),
            workspaceId: scope.workspaceId,
            type: "DOMAIN",
            revision: 1,
          },
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      createEntityMatch(
        {
          ...base,
          entity: {
            id: newUuid(),
            workspaceId: scope.workspaceId,
            type: "PERSON",
            revision: 1,
          },
          signals: [{ ...base.signals[0], strength: "CONTRADICTING" }],
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      createEntityMatch(
        {
          ...base,
          matchLevel: "VERY_HIGH",
          entity: {
            id: newUuid(),
            workspaceId: scope.workspaceId,
            type: "PERSON",
            revision: 1,
          },
          signals: [{ ...base.signals[0], strength: "WEAK" }],
        },
        now,
      ),
    ).toThrow();
  });
});

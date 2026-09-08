import { describe, expect, it } from "vitest";
import type { Entity, IdentifierView } from "../../entity/index.js";
import type { InvestigationSubject } from "../../subject/index.js";
import { composeTargetProfileView } from "./target-profile-view.js";

const subject: InvestigationSubject = Object.freeze({
  id: "018f47f2-9de3-7a89-8b7a-54db75a54d66",
  workspaceId: "018f47f2-9de3-7a89-8b7a-54db75a54d67",
  caseId: "018f47f2-9de3-7a89-8b7a-54db75a54d68",
  investigationId: null,
  subjectType: "PERSON",
  role: "PRIMARY_TARGET",
  status: "UNRESOLVED",
  entityRef: null,
  seed: null,
  revision: 1,
  createdAt: "2026-09-08T01:00:00.000Z",
  updatedAt: "2026-09-08T01:00:00.000Z",
});

describe("TargetProfileView", () => {
  it("represents an unresolved Subject without inventing canonical identity", () => {
    const value = composeTargetProfileView({
      subject,
      entity: null,
      identifiers: [],
      generatedAt: new Date("2026-09-08T02:00:00.000Z"),
    });

    expect(value).toMatchObject({
      id: subject.id,
      subject,
      entity: null,
      identitySummary: {
        displayLabel: null,
        type: "PERSON",
        resolutionStatus: "UNRESOLVED",
        aliases: [],
        identifiers: [],
      },
      sectionAvailability: { workspaceKnowledge: "NOT_IMPLEMENTED" },
      availableViews: { overview: true, canvas: false, timeline: false, map: false },
      freshness: {
        mode: "CANONICAL",
        generatedAt: "2026-09-08T02:00:00.000Z",
        sourceUpdatedAt: subject.updatedAt,
        isStale: false,
        subjectRevision: 1,
        entityRevision: null,
        latestIdentifierRevision: null,
        workspaceKnowledgeUpdatedAt: null,
      },
    });
  });

  it("composes only active fixed-mask identifiers from the canonical Entity", () => {
    const entity: Entity = Object.freeze({
      id: "018f47f2-9de3-7a89-8b7a-54db75a54d69",
      workspaceId: subject.workspaceId,
      type: "PERSON",
      status: "ACTIVE",
      canonicalLabel: "Synthetic Person",
      aliases: Object.freeze([]),
      mergedInto: null,
      revision: 3,
      createdAt: "2026-09-08T01:01:00.000Z",
      updatedAt: "2026-09-08T01:02:00.000Z",
    });
    const identifier = (status: IdentifierView["status"]): IdentifierView => ({
      id:
        status === "ACTIVE"
          ? "018f47f2-9de3-7a89-8b7a-54db75a54d70"
          : "018f47f2-9de3-7a89-8b7a-54db75a54d71",
      entityId: entity.id,
      workspaceId: entity.workspaceId,
      type: "NATIONAL_ID",
      classification: "RESTRICTED",
      status,
      revision: status === "ACTIVE" ? 2 : 4,
      createdAt: "2026-09-08T01:03:00.000Z",
      updatedAt: "2026-09-08T01:04:00.000Z",
      visibility: "MASKED",
      displayValue: "••••",
    });
    const resolved: InvestigationSubject = Object.freeze({
      ...subject,
      status: "RESOLVED",
      entityRef: { type: "ENTITY", id: entity.id, workspaceId: entity.workspaceId },
      revision: 2,
      updatedAt: "2026-09-08T01:01:30.000Z",
    });

    const value = composeTargetProfileView({
      subject: resolved,
      entity,
      identifiers: [identifier("ACTIVE"), identifier("REVOKED")],
      generatedAt: new Date("2026-09-08T02:00:00.000Z"),
    });

    expect(value.identitySummary).toMatchObject({
      displayLabel: "Synthetic Person",
      type: "PERSON",
      resolutionStatus: "RESOLVED",
    });
    expect(value.identitySummary.identifiers).toHaveLength(1);
    expect(value.identitySummary.identifiers[0]).toMatchObject({
      visibility: "MASKED",
      displayValue: "••••",
      status: "ACTIVE",
    });
    expect(value.freshness).toMatchObject({
      sourceUpdatedAt: "2026-09-08T01:04:00.000Z",
      entityRevision: 3,
      latestIdentifierRevision: 2,
    });
  });

  it("fails closed when a protected Identifier is not fixed-mask", () => {
    const entity = {
      id: "018f47f2-9de3-7a89-8b7a-54db75a54d69",
      workspaceId: subject.workspaceId,
      type: "PERSON",
      status: "ACTIVE",
      canonicalLabel: "Synthetic Person",
      aliases: [],
      mergedInto: null,
      revision: 1,
      createdAt: subject.createdAt,
      updatedAt: subject.updatedAt,
    } as const;
    const resolved = {
      ...subject,
      status: "RESOLVED",
      entityRef: { type: "ENTITY", id: entity.id, workspaceId: entity.workspaceId },
    } as const;

    expect(() =>
      composeTargetProfileView({
        subject: resolved,
        entity,
        identifiers: [
          {
            id: "018f47f2-9de3-7a89-8b7a-54db75a54d70",
            entityId: entity.id,
            workspaceId: entity.workspaceId,
            type: "NATIONAL_ID",
            classification: "RESTRICTED",
            status: "ACTIVE",
            revision: 1,
            createdAt: subject.createdAt,
            updatedAt: subject.updatedAt,
            visibility: "FULL",
            displayValue: "synthetic-protected-value",
          },
        ],
        generatedAt: new Date(),
      }),
    ).toThrow("canonical sources are inconsistent");
  });
});

import type { Entity, IdentifierView } from "../../entity/index.js";
import type { InvestigationSubject } from "../../subject/index.js";

export const TARGET_PROFILE_SECTION_AVAILABILITY = [
  "AVAILABLE",
  "NOT_IMPLEMENTED",
] as const;
export type TargetProfileSectionAvailability =
  (typeof TARGET_PROFILE_SECTION_AVAILABILITY)[number];

export type TargetProfileView = Readonly<{
  id: string;
  workspaceId: string;
  caseId: string;
  subject: InvestigationSubject;
  entity: Entity | null;
  identitySummary: Readonly<{
    displayLabel: string | null;
    type: Entity["type"] | InvestigationSubject["subjectType"];
    resolutionStatus: InvestigationSubject["status"];
    aliases: Entity["aliases"];
    identifiers: readonly IdentifierView[];
  }>;
  workspaceKnowledge: readonly never[];
  sourceCoverage: readonly never[];
  accountSummary: readonly never[];
  evidenceSummary: Readonly<{ total: null }>;
  discoverySummary: Readonly<{ total: null }>;
  openReviewSummary: Readonly<{ total: null }>;
  recentSearches: readonly never[];
  recentEvidence: readonly never[];
  recentDiscoveries: readonly never[];
  sectionAvailability: Readonly<{
    workspaceKnowledge: TargetProfileSectionAvailability;
    sourceCoverage: TargetProfileSectionAvailability;
    accounts: TargetProfileSectionAvailability;
    evidence: TargetProfileSectionAvailability;
    discoveries: TargetProfileSectionAvailability;
    reviews: TargetProfileSectionAvailability;
    searches: TargetProfileSectionAvailability;
  }>;
  availableViews: Readonly<{
    overview: true;
    canvas: false;
    timeline: false;
    map: false;
  }>;
  freshness: Readonly<{
    mode: "CANONICAL";
    generatedAt: string;
    sourceUpdatedAt: string;
    isStale: false;
    subjectRevision: number;
    entityRevision: number | null;
    latestIdentifierRevision: number | null;
    workspaceKnowledgeUpdatedAt: null;
  }>;
}>;

export function composeTargetProfileView(input: {
  subject: InvestigationSubject;
  entity: Entity | null;
  identifiers: readonly IdentifierView[];
  generatedAt: Date;
}): TargetProfileView {
  const { subject, entity } = input;
  if (
    (subject.entityRef === null) !== (entity === null) ||
    (entity !== null &&
      (entity.workspaceId !== subject.workspaceId ||
        subject.entityRef?.id !== entity.id ||
        entity.status !== "ACTIVE")) ||
    input.identifiers.some(
      (identifier) =>
        !entity ||
        identifier.entityId !== entity.id ||
        identifier.workspaceId !== subject.workspaceId ||
        identifier.visibility !== "MASKED" ||
        identifier.displayValue !== "••••",
    )
  )
    throw new Error("Target Profile canonical sources are inconsistent.");

  const generatedAt = input.generatedAt.toISOString();
  const identifiers = input.identifiers
    .filter((identifier) => identifier.status === "ACTIVE")
    .map((identifier) => Object.freeze({ ...identifier }));
  const sourceUpdatedAt = [
    subject.updatedAt,
    entity?.updatedAt,
    ...identifiers.map((identifier) => identifier.updatedAt),
  ]
    .filter((value): value is string => value !== undefined)
    .sort()
    .at(-1)!;
  const unavailable = "NOT_IMPLEMENTED" as const;
  const empty = Object.freeze([]) as readonly never[];

  return Object.freeze({
    id: subject.id,
    workspaceId: subject.workspaceId,
    caseId: subject.caseId,
    subject: Object.freeze({ ...subject }),
    entity: entity ? Object.freeze({ ...entity }) : null,
    identitySummary: Object.freeze({
      displayLabel: entity?.canonicalLabel ?? null,
      type: entity?.type ?? subject.subjectType,
      resolutionStatus: subject.status,
      aliases: Object.freeze(
        entity?.aliases.map((alias) => Object.freeze({ ...alias })) ?? [],
      ),
      identifiers: Object.freeze(identifiers),
    }),
    workspaceKnowledge: empty,
    sourceCoverage: empty,
    accountSummary: empty,
    evidenceSummary: Object.freeze({ total: null }),
    discoverySummary: Object.freeze({ total: null }),
    openReviewSummary: Object.freeze({ total: null }),
    recentSearches: empty,
    recentEvidence: empty,
    recentDiscoveries: empty,
    sectionAvailability: Object.freeze({
      workspaceKnowledge: unavailable,
      sourceCoverage: unavailable,
      accounts: unavailable,
      evidence: unavailable,
      discoveries: unavailable,
      reviews: unavailable,
      searches: unavailable,
    }),
    availableViews: Object.freeze({
      overview: true,
      canvas: false,
      timeline: false,
      map: false,
    }),
    freshness: Object.freeze({
      mode: "CANONICAL",
      generatedAt,
      sourceUpdatedAt,
      isStale: false,
      subjectRevision: subject.revision,
      entityRevision: entity?.revision ?? null,
      latestIdentifierRevision:
        identifiers.length === 0
          ? null
          : Math.max(...identifiers.map((identifier) => identifier.revision)),
      workspaceKnowledgeUpdatedAt: null,
    }),
  });
}

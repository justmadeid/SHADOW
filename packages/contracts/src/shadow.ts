import type {
  ClassifiedFieldView,
  DataClassification,
  FieldVisibility,
} from "./classification.js";

export const SUBJECT_TYPES = [
  "PERSON",
  "ORGANIZATION",
  "SOCIAL_ACCOUNT",
  "DOMAIN",
  "UNKNOWN",
] as const;
export const SUBJECT_ROLES = [
  "PRIMARY_TARGET",
  "SECONDARY_TARGET",
  "PERSON_OF_INTEREST",
  "RELATED_PERSON",
  "WITNESS",
  "UNKNOWN",
] as const;
export const SUBJECT_SEED_FIELD_NAMES = [
  "DISPLAY_NAME",
  "ORGANIZATION_NAME",
  "USERNAME",
  "DOMAIN_NAME",
  "LOCATION_TEXT",
  "SOCIAL_PROFILE_URL",
] as const;
export const RESOLUTION_REASON_CODES = [
  "EXACT_IDENTIFIER_MATCH",
  "MULTIPLE_SUPPORTING_SIGNALS",
  "INSUFFICIENT_EVIDENCE",
  "CONFLICTING_SIGNALS",
  "NOT_SAME_IDENTITY",
  "MANUAL_REVIEW",
] as const;

export type SubjectType = (typeof SUBJECT_TYPES)[number];
export type SubjectRole = (typeof SUBJECT_ROLES)[number];
export type SubjectSeedFieldName = (typeof SUBJECT_SEED_FIELD_NAMES)[number];
export type ResolutionReasonCode = (typeof RESOLUTION_REASON_CODES)[number];
export type SubjectStatus =
  "UNRESOLVED" | "RESOLVING" | "RESOLVED" | "RESOLUTION_FAILED" | "ARCHIVED";
export type EntityType =
  | Exclude<SubjectType, "UNKNOWN">
  | "EMAIL_ADDRESS"
  | "PHONE_NUMBER"
  | "LOCATION"
  | "ADDRESS"
  | "WEBSITE"
  | "IP_ADDRESS"
  | "VEHICLE"
  | "DEVICE"
  | "DOCUMENT"
  | "EVENT";

export type EntityRef = { type: "ENTITY"; id: string; workspaceId: string };
export type InvestigationSubject = {
  id: string;
  workspaceId: string;
  caseId: string;
  investigationId: string | null;
  subjectType: SubjectType;
  role: SubjectRole;
  status: SubjectStatus;
  entityRef: EntityRef | null;
  seed: { id: string; fieldCount: number } | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type SubjectPage = {
  items: InvestigationSubject[];
  page: { hasMore: boolean; nextCursor: string | null };
};
export type SubjectSeed = {
  id: string;
  subjectId: string;
  workspaceId: string;
  caseId: string;
  fields: Array<{
    id: string;
    ordinal: number;
    name: SubjectSeedFieldName;
    origin: string;
    classification: DataClassification;
    evidenceRef: null;
    sourceRecordRef: null;
    value: ClassifiedFieldView;
  }>;
  createdAt: string;
};
export type ResolutionSession = {
  id: string;
  subjectId: string;
  workspaceId: string;
  caseId: string;
  status: "SEARCHING" | "NEEDS_REVIEW" | "RESOLVED" | "CLOSED";
  candidatesCount: number;
  selectedCandidateId: string | null;
  resolutionDecisionId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type Candidate = {
  id: string;
  resolutionSessionId: string;
  subjectId: string;
  workspaceId: string;
  caseId: string;
  type: Exclude<SubjectType, "UNKNOWN">;
  status: "PENDING_REVIEW" | "RESOLVED" | "REJECTED" | "UNCERTAIN";
  displayLabel: string;
  classification: DataClassification;
  source: {
    origin: string;
    resource: null | { type: string; id: string; workspaceId: string; caseId?: string };
  };
  evidenceRefs: Array<{ type: string; id: string; workspaceId: string; caseId?: string }>;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type CandidatePage = {
  items: Candidate[];
  page: { hasMore: boolean; nextCursor: string | null };
};
export type MatchSignalView = {
  field: string;
  result: string;
  strength: string;
  valueVisibility: FieldVisibility;
};
export type EntityMatchView = {
  id: string;
  candidateId: string;
  entityRef: EntityRef;
  matchLevel: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  signals: MatchSignalView[];
  conflicts: MatchSignalView[];
  crossCaseContext: { exists: true; detailsVisible: boolean };
  createdAt: string;
};
export type EntityMatchPage = {
  items: EntityMatchView[];
  page: { hasMore: boolean; nextCursor: string | null };
};
export type Entity = {
  id: string;
  workspaceId: string;
  type: EntityType;
  status: "ACTIVE" | "MERGED" | "ARCHIVED";
  canonicalLabel: string;
  aliases: Array<{ id: string; label: string; createdAt: string }>;
  mergedInto: EntityRef | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type IdentifierView = {
  id: string;
  entityId: string;
  workspaceId: string;
  type: string;
  classification: DataClassification;
  status: "ACTIVE" | "REVOKED";
  revision: number;
  createdAt: string;
  updatedAt: string;
} & ClassifiedFieldView;
export type TargetProfileView = {
  id: string;
  workspaceId: string;
  caseId: string;
  subject: InvestigationSubject;
  entity: Entity | null;
  identitySummary: {
    displayLabel: string | null;
    type: EntityType | SubjectType;
    resolutionStatus: SubjectStatus;
    aliases: Entity["aliases"];
    identifiers: IdentifierView[];
  };
  sectionAvailability: Record<
    | "workspaceKnowledge"
    | "sourceCoverage"
    | "accounts"
    | "evidence"
    | "discoveries"
    | "reviews"
    | "searches",
    "AVAILABLE" | "NOT_IMPLEMENTED"
  >;
  availableViews: { overview: true; canvas: false; timeline: false; map: false };
  freshness: {
    mode: "CANONICAL";
    generatedAt: string;
    sourceUpdatedAt: string;
    isStale: false;
    subjectRevision: number;
    entityRevision: number | null;
    latestIdentifierRevision: number | null;
    workspaceKnowledgeUpdatedAt: null;
  };
};

/** IDs only: raw target inputs and credentials are never encoded into navigation. */
export function shadowTargetHref(input: {
  workspaceId: string;
  caseId: string;
  subjectId: string;
  resolutionId?: string;
}): string {
  const ids = [
    input.workspaceId,
    input.caseId,
    input.subjectId,
    input.resolutionId,
  ].filter((value): value is string => Boolean(value));
  if (
    ids.some(
      (value) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value,
        ),
    )
  )
    throw new Error("Invalid Target context");
  const query = new URLSearchParams({
    workspaceId: input.workspaceId,
    caseId: input.caseId,
    ...(input.resolutionId ? { resolutionId: input.resolutionId } : {}),
  });
  return `/shadow/cases/${input.caseId}/targets/${input.subjectId}?${query}`;
}

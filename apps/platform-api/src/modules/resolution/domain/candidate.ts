import {
  DATA_CLASSIFICATIONS,
  isResourceId,
  type DataClassification,
  type ResourceRef,
} from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";

export const CANDIDATE_TYPES = [
  "PERSON",
  "ORGANIZATION",
  "SOCIAL_ACCOUNT",
  "DOMAIN",
] as const;
export const CANDIDATE_STATUSES = [
  "PENDING_REVIEW",
  "RESOLVED",
  "REJECTED",
  "UNCERTAIN",
] as const;
export const CANDIDATE_SOURCE_ORIGINS = [
  "INVESTIGATOR_INPUT",
  "SOURCE_RECORD",
  "EVIDENCE",
  "RUN",
  "ANALYSIS_EXTRACTION",
  "IMPORT",
] as const;
export const RESOLUTION_DECISIONS = [
  "LINK_EXISTING",
  "CREATE_NEW",
  "UNCERTAIN",
  "REJECT",
] as const;
export const RESOLUTION_REASON_CODES = [
  "EXACT_IDENTIFIER_MATCH",
  "MULTIPLE_SUPPORTING_SIGNALS",
  "INSUFFICIENT_EVIDENCE",
  "CONFLICTING_SIGNALS",
  "NOT_SAME_IDENTITY",
  "MANUAL_REVIEW",
] as const;
export const RESTRICTED_CANDIDATE_LABEL = "Restricted candidate";

export type CandidateType = (typeof CANDIDATE_TYPES)[number];
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
export type CandidateSourceOrigin = (typeof CANDIDATE_SOURCE_ORIGINS)[number];
export type ResolutionDecisionType = (typeof RESOLUTION_DECISIONS)[number];
export type ResolutionReasonCode = (typeof RESOLUTION_REASON_CODES)[number];

export type CandidateSource = Readonly<{
  origin: CandidateSourceOrigin;
  resource: ResourceRef | null;
}>;

/** A review artifact only. It never owns or mutates canonical Entity identity. */
export type Candidate = Readonly<{
  id: string;
  resolutionSessionId: string;
  subjectId: string;
  workspaceId: string;
  caseId: string;
  type: CandidateType;
  status: CandidateStatus;
  displayLabel: string;
  classification: DataClassification;
  source: CandidateSource;
  evidenceRefs: readonly ResourceRef[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateCandidateInput = {
  type: CandidateType;
  displayLabel: string | null;
  classification: DataClassification;
  source: CandidateSource;
  evidenceRefs?: readonly ResourceRef[];
};

export type ResolutionDecision = Readonly<{
  id: string;
  resolutionSessionId: string;
  candidateId: string;
  decision: ResolutionDecisionType;
  targetEntityId: string | null;
  reasonCode: ResolutionReasonCode;
  decidedByUserId: string;
  decidedAt: string;
}>;

export function createCandidate(
  input: CreateCandidateInput & {
    id: string;
    resolutionSessionId: string;
    subjectId: string;
    workspaceId: string;
    caseId: string;
    subjectType: CandidateType | "UNKNOWN";
  },
  now: Date,
): Candidate {
  for (const id of [
    input.id,
    input.resolutionSessionId,
    input.subjectId,
    input.workspaceId,
    input.caseId,
  ])
    validateId(id);
  if (!CANDIDATE_TYPES.includes(input.type)) invalid();
  if (input.subjectType !== "UNKNOWN" && input.subjectType !== input.type)
    throw new AppError({
      code: "CANDIDATE_SUBJECT_TYPE_MISMATCH",
      message: "Candidate type must be compatible with its Subject.",
      statusCode: 409,
    });
  if (!DATA_CLASSIFICATIONS.includes(input.classification)) invalid();
  // Raw RESTRICTED labels are prohibited. A fixed non-identifying label keeps the
  // Candidate reviewable through policy-safe signals without duplicating the value.
  if (input.classification === "RESTRICTED" && input.displayLabel !== null) invalid();
  const displayLabel =
    input.classification === "RESTRICTED"
      ? RESTRICTED_CANDIDATE_LABEL
      : normalizeLabel(input.displayLabel);
  const source = validateSource(input.source, input.workspaceId, input.caseId);
  const evidenceRefs = validateEvidenceRefs(
    input.evidenceRefs ?? [],
    input.workspaceId,
    input.caseId,
  );
  const timestamp = instant(now);
  return freezeCandidate({
    id: input.id,
    resolutionSessionId: input.resolutionSessionId,
    subjectId: input.subjectId,
    workspaceId: input.workspaceId,
    caseId: input.caseId,
    type: input.type,
    status: "PENDING_REVIEW",
    displayLabel,
    classification: input.classification,
    source,
    evidenceRefs,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function decideCandidate(
  current: Candidate,
  input: {
    id: string;
    decision: ResolutionDecisionType;
    targetEntityId?: string | null;
    reasonCode: ResolutionReasonCode;
    decidedByUserId: string;
  },
  expectedRevision: number,
  now: Date,
): { candidate: Candidate; decision: ResolutionDecision } {
  assertExpectedRevision(expectedRevision, current.revision);
  if (current.status !== "PENDING_REVIEW")
    throw new AppError({
      code: "CANDIDATE_ALREADY_DECIDED",
      message: "Candidate has already received a decision.",
      statusCode: 409,
    });
  if (
    !Number.isSafeInteger(current.revision) ||
    current.revision < 1 ||
    current.revision === Number.MAX_SAFE_INTEGER
  )
    invalid();
  validateId(input.id);
  if (!RESOLUTION_DECISIONS.includes(input.decision)) invalid();
  if (!RESOLUTION_REASON_CODES.includes(input.reasonCode)) invalid();
  if (!input.decidedByUserId.trim() || input.decidedByUserId.length > 255) invalid();
  const requiresEntity = ["LINK_EXISTING", "CREATE_NEW"].includes(input.decision);
  if (requiresEntity !== Boolean(input.targetEntityId)) invalid();
  if (input.targetEntityId) validateId(input.targetEntityId);
  const decidedAt = instant(now);
  if (decidedAt < current.updatedAt) invalid();
  const status: CandidateStatus =
    input.decision === "REJECT"
      ? "REJECTED"
      : input.decision === "UNCERTAIN"
        ? "UNCERTAIN"
        : "RESOLVED";
  return {
    candidate: freezeCandidate({
      ...current,
      status,
      revision: current.revision + 1,
      updatedAt: decidedAt,
    }),
    decision: Object.freeze({
      id: input.id,
      resolutionSessionId: current.resolutionSessionId,
      candidateId: current.id,
      decision: input.decision,
      targetEntityId: input.targetEntityId ?? null,
      reasonCode: input.reasonCode,
      decidedByUserId: input.decidedByUserId,
      decidedAt,
    }),
  };
}

function validateSource(
  source: CandidateSource,
  workspaceId: string,
  caseId: string,
): CandidateSource {
  if (
    !source ||
    typeof source !== "object" ||
    !CANDIDATE_SOURCE_ORIGINS.includes(source.origin)
  )
    invalid();
  const expectedType: Partial<Record<CandidateSourceOrigin, ResourceRef["type"]>> = {
    SOURCE_RECORD: "SOURCE_RECORD",
    EVIDENCE: "EVIDENCE",
    RUN: "RUN",
    ANALYSIS_EXTRACTION: "ANALYSIS",
    IMPORT: "SOURCE_RECORD",
  };
  const type = expectedType[source.origin];
  if (!type) {
    if (source.resource !== null) invalid();
    return Object.freeze({ origin: source.origin, resource: null });
  }
  if (!validScopedRef(source.resource, type, workspaceId, caseId)) invalid();
  return Object.freeze({
    origin: source.origin,
    resource: Object.freeze({ ...source.resource }),
  });
}

function validateEvidenceRefs(
  refs: readonly ResourceRef[],
  workspaceId: string,
  caseId: string,
): readonly ResourceRef[] {
  if (!Array.isArray(refs) || refs.length > 20) invalid();
  const seen = new Set<string>();
  return Object.freeze(
    refs.map((ref) => {
      if (!validScopedRef(ref, "EVIDENCE", workspaceId, caseId) || seen.has(ref.id))
        invalid();
      seen.add(ref.id);
      return Object.freeze({ ...ref });
    }),
  );
}

function validScopedRef(
  ref: ResourceRef | null,
  type: ResourceRef["type"],
  workspaceId: string,
  caseId: string,
): ref is ResourceRef {
  return Boolean(
    ref &&
    ref.type === type &&
    isResourceId(ref.id) &&
    ref.workspaceId === workspaceId &&
    ref.caseId === caseId,
  );
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== "string" || hasControlCharacters(value)) invalid();
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalized.length < 1 || normalized.length > 200) invalid();
  return normalized;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 31 || code === 127;
  });
}

function freezeCandidate(value: Candidate): Candidate {
  return Object.freeze({
    ...value,
    source: Object.freeze({
      ...value.source,
      resource: value.source.resource
        ? Object.freeze({ ...value.source.resource })
        : null,
    }),
    evidenceRefs: Object.freeze(
      value.evidenceRefs.map((reference) => Object.freeze({ ...reference })),
    ),
  });
}

function validateId(value: string): void {
  if (!isResourceId(value)) invalid();
}
function instant(value: Date): string {
  if (!Number.isFinite(value.getTime())) invalid();
  return value.toISOString();
}
function invalid(): never {
  throw new AppError({
    code: "VALIDATION_CANDIDATE_INVALID",
    message: "Candidate input is invalid.",
    statusCode: 400,
  });
}

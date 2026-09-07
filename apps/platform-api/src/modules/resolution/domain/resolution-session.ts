import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import type { Candidate, ResolutionDecision } from "./candidate.js";

export const RESOLUTION_SESSION_STATUSES = [
  "SEARCHING",
  "NEEDS_REVIEW",
  "RESOLVED",
  "CLOSED",
] as const;
export type ResolutionSessionStatus = (typeof RESOLUTION_SESSION_STATUSES)[number];

export type ResolutionSession = Readonly<{
  id: string;
  subjectId: string;
  workspaceId: string;
  caseId: string;
  status: ResolutionSessionStatus;
  candidatesCount: number;
  selectedCandidateId: string | null;
  resolutionDecisionId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

export function createResolutionSession(
  input: Pick<ResolutionSession, "id" | "subjectId" | "workspaceId" | "caseId">,
  now: Date,
): ResolutionSession {
  for (const id of [input.id, input.subjectId, input.workspaceId, input.caseId])
    validateId(id);
  const timestamp = instant(now);
  return freeze({
    ...input,
    status: "SEARCHING",
    candidatesCount: 0,
    selectedCandidateId: null,
    resolutionDecisionId: null,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function registerCandidate(
  current: ResolutionSession,
  candidate: Candidate,
  expectedRevision: number,
  now: Date,
): ResolutionSession {
  mutable(current, expectedRevision);
  if (!["SEARCHING", "NEEDS_REVIEW"].includes(current.status)) transitionDenied();
  if (
    candidate.resolutionSessionId !== current.id ||
    candidate.subjectId !== current.subjectId ||
    candidate.workspaceId !== current.workspaceId ||
    candidate.caseId !== current.caseId ||
    candidate.status !== "PENDING_REVIEW" ||
    current.candidatesCount === Number.MAX_SAFE_INTEGER
  )
    invalid();
  return next(
    current,
    { status: "NEEDS_REVIEW", candidatesCount: current.candidatesCount + 1 },
    now,
  );
}

export function closeEmptyResolutionSession(
  current: ResolutionSession,
  expectedRevision: number,
  now: Date,
): ResolutionSession {
  mutable(current, expectedRevision);
  if (current.status !== "SEARCHING" || current.candidatesCount !== 0) transitionDenied();
  return next(current, { status: "CLOSED" }, now);
}

export function recordResolutionDecision(
  current: ResolutionSession,
  candidate: Candidate,
  decision: ResolutionDecision,
  remainingPendingCandidates: number,
  expectedRevision: number,
  now: Date,
): ResolutionSession {
  mutable(current, expectedRevision);
  if (current.status !== "NEEDS_REVIEW") transitionDenied();
  if (
    candidate.resolutionSessionId !== current.id ||
    candidate.subjectId !== current.subjectId ||
    candidate.workspaceId !== current.workspaceId ||
    candidate.caseId !== current.caseId ||
    decision.resolutionSessionId !== current.id ||
    decision.candidateId !== candidate.id ||
    !isResourceId(decision.id) ||
    !Number.isSafeInteger(remainingPendingCandidates) ||
    remainingPendingCandidates < 0 ||
    remainingPendingCandidates > current.candidatesCount - 1
  )
    invalid();
  const conclusive = ["LINK_EXISTING", "CREATE_NEW"].includes(decision.decision);
  const expectedCandidateStatus = conclusive
    ? "RESOLVED"
    : decision.decision === "REJECT"
      ? "REJECTED"
      : decision.decision === "UNCERTAIN"
        ? "UNCERTAIN"
        : null;
  if (!expectedCandidateStatus || candidate.status !== expectedCandidateStatus) invalid();
  if (conclusive)
    return next(
      current,
      {
        status: "RESOLVED",
        selectedCandidateId: candidate.id,
        resolutionDecisionId: decision.id,
      },
      now,
    );
  if (remainingPendingCandidates > 0)
    return next(current, { status: "NEEDS_REVIEW" }, now);
  return next(
    current,
    {
      status: "CLOSED",
      selectedCandidateId: candidate.id,
      resolutionDecisionId: decision.id,
    },
    now,
  );
}

function mutable(current: ResolutionSession, revision: number): void {
  assertExpectedRevision(revision, current.revision);
  if (["RESOLVED", "CLOSED"].includes(current.status)) transitionDenied();
  if (
    !Number.isSafeInteger(current.revision) ||
    current.revision < 1 ||
    current.revision === Number.MAX_SAFE_INTEGER
  )
    invalid();
}

function next(
  current: ResolutionSession,
  changes: Partial<
    Pick<
      ResolutionSession,
      "status" | "candidatesCount" | "selectedCandidateId" | "resolutionDecisionId"
    >
  >,
  now: Date,
): ResolutionSession {
  const updatedAt = instant(now);
  if (updatedAt < current.updatedAt) invalid();
  return freeze({
    ...current,
    ...changes,
    revision: current.revision + 1,
    updatedAt,
  });
}

function freeze(value: ResolutionSession): ResolutionSession {
  return Object.freeze({ ...value });
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
    code: "VALIDATION_RESOLUTION_INVALID",
    message: "Resolution input is invalid.",
    statusCode: 400,
  });
}
function transitionDenied(): never {
  throw new AppError({
    code: "RESOLUTION_INVALID_STATUS_TRANSITION",
    message: "Resolution status transition is not allowed.",
    statusCode: 409,
  });
}

import { isResourceId, type ResourceRef } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import type { SubjectSeedSummary } from "./subject-seed.js";

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
export const SUBJECT_STATUSES = [
  "UNRESOLVED",
  "RESOLVING",
  "RESOLVED",
  "RESOLUTION_FAILED",
  "ARCHIVED",
] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export type SubjectRole = (typeof SUBJECT_ROLES)[number];
export type SubjectStatus = (typeof SUBJECT_STATUSES)[number];
export type SubjectEntityRef = Readonly<
  Pick<ResourceRef, "id" | "workspaceId"> & { type: "ENTITY" }
>;

/** Case context only; seed values and canonical identity belong to separate models. */
export type InvestigationSubject = Readonly<{
  id: string;
  workspaceId: string;
  caseId: string;
  investigationId: string | null;
  subjectType: SubjectType;
  role: SubjectRole;
  status: SubjectStatus;
  entityRef: SubjectEntityRef | null;
  seed: SubjectSeedSummary | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}>;

/** Trusted application port, never a DTO supplied by an HTTP caller.
 * P2-003 must resolve merged IDs and verify existence in the owning Registry.
 * P2-008 must invoke it in the same transaction as the resolution decision/write.
 */
export interface CanonicalEntityResolver {
  resolve(
    workspaceId: string,
    entityId: string,
  ): Promise<{
    id: string;
    workspaceId: string;
    type: string;
    status: "ACTIVE";
  } | null>;
}

export function createSubject(
  input: {
    id: string;
    workspaceId: string;
    caseId: string;
    investigationId?: string | null;
    subjectType: SubjectType;
    role: SubjectRole;
    seed?: SubjectSeedSummary | null;
  },
  now: Date,
): InvestigationSubject {
  for (const id of [input.id, input.workspaceId, input.caseId]) validateId(id);
  if (input.investigationId != null) validateId(input.investigationId);
  if (!SUBJECT_TYPES.includes(input.subjectType) || !SUBJECT_ROLES.includes(input.role))
    invalid();
  const timestamp = instant(now);
  return freeze({
    id: input.id,
    workspaceId: input.workspaceId,
    caseId: input.caseId,
    investigationId: input.investigationId ?? null,
    subjectType: input.subjectType,
    role: input.role,
    status: "UNRESOLVED",
    entityRef: null,
    seed: input.seed ?? null,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function updateSubjectRole(
  current: InvestigationSubject,
  role: SubjectRole,
  revision: number,
  now: Date,
): InvestigationSubject {
  mutable(current, revision);
  if (!SUBJECT_ROLES.includes(role)) invalid();
  return next(current, { role }, now);
}

export function startSubjectResolution(
  current: InvestigationSubject,
  revision: number,
  now: Date,
): InvestigationSubject {
  mutable(current, revision);
  if (!["UNRESOLVED", "RESOLUTION_FAILED"].includes(current.status)) transitionDenied();
  return next(current, { status: "RESOLVING" }, now);
}

export function failSubjectResolution(
  current: InvestigationSubject,
  revision: number,
  now: Date,
): InvestigationSubject {
  mutable(current, revision);
  if (current.status !== "RESOLVING") transitionDenied();
  return next(current, { status: "RESOLUTION_FAILED" }, now);
}

export async function resolveSubject(
  current: InvestigationSubject,
  entityId: string,
  resolver: CanonicalEntityResolver,
  revision: number,
  now: Date,
): Promise<InvestigationSubject> {
  mutable(current, revision);
  if (current.status !== "RESOLVING") transitionDenied();
  validateId(entityId);
  const canonical = await resolver.resolve(current.workspaceId, entityId);
  if (
    !canonical ||
    !isResourceId(canonical.id) ||
    canonical.workspaceId !== current.workspaceId ||
    canonical.status !== "ACTIVE" ||
    (current.subjectType !== "UNKNOWN" && canonical.type !== current.subjectType)
  ) {
    throw new AppError({
      code: "SUBJECT_CANONICAL_ENTITY_REQUIRED",
      message: "A compatible canonical Entity in the same Workspace is required.",
      statusCode: 409,
    });
  }
  return next(
    current,
    {
      status: "RESOLVED",
      entityRef: { type: "ENTITY", id: canonical.id, workspaceId: canonical.workspaceId },
    },
    now,
  );
}

export function archiveSubject(
  current: InvestigationSubject,
  revision: number,
  now: Date,
): InvestigationSubject {
  mutable(current, revision);
  // Keep the Entity linkage when archiving; archival is not identity retraction.
  return next(current, { status: "ARCHIVED" }, now);
}

function mutable(current: InvestigationSubject, revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) invalid();
  assertExpectedRevision(revision, current.revision);
  if (current.status === "ARCHIVED") transitionDenied();
  if (
    !Number.isSafeInteger(current.revision) ||
    current.revision < 1 ||
    current.revision === Number.MAX_SAFE_INTEGER
  )
    invalid();
}
function next(
  current: InvestigationSubject,
  changes: Partial<Pick<InvestigationSubject, "role" | "status" | "entityRef">>,
  now: Date,
): InvestigationSubject {
  const updatedAt = instant(now);
  if (updatedAt < current.updatedAt) invalid();
  return freeze({ ...current, ...changes, revision: current.revision + 1, updatedAt });
}
function freeze(value: InvestigationSubject): InvestigationSubject {
  return Object.freeze({
    ...value,
    entityRef: value.entityRef ? Object.freeze({ ...value.entityRef }) : null,
    seed: value.seed ? Object.freeze({ ...value.seed }) : null,
  });
}
function validateId(id: string): void {
  if (!isResourceId(id)) invalid();
}
function instant(now: Date): string {
  if (!Number.isFinite(now.getTime())) invalid();
  return now.toISOString();
}
function invalid(): never {
  throw new AppError({
    code: "VALIDATION_SUBJECT_INVALID",
    message: "Subject input is invalid.",
    statusCode: 400,
  });
}
function transitionDenied(): never {
  throw new AppError({
    code: "SUBJECT_INVALID_STATUS_TRANSITION",
    message: "Subject status transition is not allowed.",
    statusCode: 409,
  });
}

import { DATA_CLASSIFICATIONS, type DataClassification } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import { assertUuid } from "../../../platform/ids/uuid.js";

export const AUDIT_ACTIONS = [
  "CASE_MEMBERSHIP_GRANTED",
  "CASE_MEMBERSHIP_REVOKED",
  "SENSITIVE_FIELD_VIEW",
  "SENSITIVE_FIELD_MATCH",
  "EVIDENCE_EXPORT_AUTHORIZATION",
  "SOURCE_ACCESS_AUTHORIZATION",
] as const;
export const AUDIT_RESOURCE_TYPES = [
  "WORKSPACE",
  "CASE",
  "INVESTIGATION",
  "ENTITY",
  "EVIDENCE",
  "IDENTIFIER",
  "EXPORT",
  "GOVERNANCE",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditInput = {
  operationId: string;
  action: AuditAction;
  outcome: "SUCCEEDED" | "AUTHORIZED" | "DENIED";
  resource: {
    type: (typeof AUDIT_RESOURCE_TYPES)[number];
    id: string;
    workspaceId: string;
    caseId?: string;
  };
  reason?: string;
  classification?: DataClassification;
  membershipId?: string;
  resourceRevision?: number;
};
export type AuditEvent = {
  id: string;
  version: 1;
  operationId: string;
  action: AuditAction;
  outcome: AuditInput["outcome"];
  workspaceId: string;
  caseId: string | null;
  resourceType: AuditInput["resource"]["type"];
  resourceId: string;
  actorType: "USER" | "SERVICE";
  actorId: string;
  requestId: string;
  traceId: string;
  reason: string | null;
  classification: DataClassification | null;
  membershipId: string | null;
  resourceRevision: number | null;
  occurredAt: Date;
};
export interface AuditStore {
  append(event: AuditEvent): Promise<string>;
}

/** Reject unknown fields; no free-form metadata or raw-value payload channel. */
export function validateAuditInput(input: AuditInput): void {
  const invalid = (): never => {
    throw new AppError({
      code: "AUDIT_INPUT_INVALID",
      message: "Audit input is invalid.",
      statusCode: 400,
    });
  };
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).some(
      (key) =>
        ![
          "operationId",
          "action",
          "outcome",
          "resource",
          "reason",
          "classification",
          "membershipId",
          "resourceRevision",
        ].includes(key),
    )
  )
    invalid();
  if (
    !AUDIT_ACTIONS.includes(input.action) ||
    !["SUCCEEDED", "AUTHORIZED", "DENIED"].includes(input.outcome)
  )
    invalid();
  const r = input.resource;
  if (
    !r ||
    typeof r !== "object" ||
    !AUDIT_RESOURCE_TYPES.includes(r.type) ||
    Object.keys(r).some((key) => !["type", "id", "workspaceId", "caseId"].includes(key))
  )
    invalid();
  try {
    for (const id of [
      input.operationId,
      r.id,
      r.workspaceId,
      ...(r.caseId !== undefined ? [r.caseId] : []),
      ...(input.membershipId !== undefined ? [input.membershipId] : []),
    ])
      assertUuid(id);
  } catch {
    invalid();
  }
  if (r.type === "CASE" && r.caseId !== r.id) invalid();
  if (
    input.reason !== undefined &&
    (typeof input.reason !== "string" ||
      !input.reason.trim() ||
      input.reason.length > 1000)
  )
    invalid();
  if (
    input.classification !== undefined &&
    !DATA_CLASSIFICATIONS.includes(input.classification)
  )
    invalid();
  if (
    input.resourceRevision !== undefined &&
    (!Number.isSafeInteger(input.resourceRevision) || input.resourceRevision < 1)
  )
    invalid();
  const membership = input.action.startsWith("CASE_MEMBERSHIP_");
  if (
    membership &&
    (input.outcome !== "SUCCEEDED" ||
      r.type !== "CASE" ||
      !input.membershipId ||
      !input.resourceRevision ||
      !input.reason)
  )
    invalid();
  if (
    !membership &&
    (input.outcome === "SUCCEEDED" ||
      input.membershipId !== undefined ||
      input.classification === undefined)
  )
    invalid();
  if (
    !membership &&
    input.outcome === "AUTHORIZED" &&
    (input.action !== "SOURCE_ACCESS_AUTHORIZATION" ||
      input.classification === "RESTRICTED") &&
    !input.reason
  )
    invalid();
}

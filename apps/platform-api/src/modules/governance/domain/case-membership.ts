import { AppError } from "../../../platform/errors/index.js";
import type { Permission } from "./governance.js";

export const CASE_ROLES = ["OWNER", "EDITOR", "VIEWER"] as const;
export type CaseRole = (typeof CASE_ROLES)[number];
export const CASE_ROLE_PERMISSIONS: Record<CaseRole, readonly Permission[]> = {
  OWNER: [
    "CASE_VIEW",
    "CASE_UPDATE",
    "GOVERNANCE_ROLE_MANAGE",
    "INVESTIGATION_VIEW",
    "INVESTIGATION_CREATE",
    "INVESTIGATION_UPDATE",
  ],
  EDITOR: [
    "CASE_VIEW",
    "CASE_UPDATE",
    "INVESTIGATION_VIEW",
    "INVESTIGATION_CREATE",
    "INVESTIGATION_UPDATE",
  ],
  VIEWER: ["CASE_VIEW", "INVESTIGATION_VIEW"],
};

export type CaseMembership = {
  id: string;
  workspaceId: string;
  caseId: string;
  userId: string;
  role: CaseRole;
  status: "ACTIVE" | "REVOKED";
  revision: number;
};

export interface CaseMembershipStore {
  lockCase(workspaceId: string, caseId: string): Promise<void>;
  grant(
    workspaceId: string,
    caseId: string,
    userId: string,
    role: CaseRole,
    actorUserId: string,
    reason: string,
  ): Promise<CaseMembership>;
  revoke(
    workspaceId: string,
    caseId: string,
    membershipId: string,
    expectedRevision: number,
    actorUserId: string,
    reason: string,
  ): Promise<CaseMembership>;
  listCaseIds(workspaceId: string, userId: string, before?: string): Promise<string[]>;
}

export function validateMembershipInput(
  userId: string,
  role: CaseRole,
  reason: string,
): void {
  if (
    !userId.trim() ||
    userId.length > 255 ||
    !CASE_ROLES.includes(role) ||
    !reason.trim() ||
    reason.length > 1000
  ) {
    throw new AppError({
      code: "VALIDATION_CASE_MEMBERSHIP_INVALID",
      message:
        "Membership requires a user, valid Case role, and a reason (1-1000 characters).",
      statusCode: 400,
    });
  }
}

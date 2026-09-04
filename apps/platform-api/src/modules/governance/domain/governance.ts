import { AppError } from "../../../platform/errors/index.js";

export const PERMISSIONS = [
  "WORKSPACE_VIEW",
  "WORKSPACE_MANAGE",
  "CASE_CREATE",
  "CASE_VIEW",
  "CASE_UPDATE",
  "INVESTIGATION_CREATE",
  "INVESTIGATION_VIEW",
  "INVESTIGATION_UPDATE",
  "GOVERNANCE_ROLE_VIEW",
  "GOVERNANCE_ROLE_MANAGE",
  "DISCOVER_ENTITY_EXISTENCE",
  "VIEW_CROSS_CASE_CONTEXT",
  "VIEW_CROSS_CASE_EVIDENCE",
  "IDENTIFIER_USE_RESTRICTED",
  "IDENTIFIER_VIEW_RESTRICTED",
  "EVIDENCE_EXPORT",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type GovernanceAction = Permission;
export type GovernanceSubjectType = "USER" | "SERVICE";
export type GovernanceResourceType =
  | "WORKSPACE"
  | "CASE"
  | "INVESTIGATION"
  | "ENTITY"
  | "EVIDENCE"
  | "IDENTIFIER"
  | "EXPORT"
  | "GOVERNANCE";
export type GovernanceScopeType = "WORKSPACE" | "CASE" | "RESOURCE";
export type GovernanceStatus = "ACTIVE" | "REVOKED";

export type Role = {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

export type GovernanceScope =
  | { type: "WORKSPACE" }
  | { type: "CASE"; resourceId: string }
  | {
      type: "RESOURCE";
      resourceType: GovernanceResourceType;
      resourceId: string;
    };

export type RoleAssignment = {
  id: string;
  workspaceId: string;
  roleId: string;
  subjectType: GovernanceSubjectType;
  subjectId: string;
  scope: GovernanceScope;
  status: GovernanceStatus;
  revision: number;
  grantedBySubjectType: GovernanceSubjectType;
  grantedBySubjectId: string;
  grantedAt: Date;
  revokedAt: Date | null;
};

export type PolicyResource = {
  type: GovernanceResourceType;
  id: string;
  workspaceId: string;
};

export type PolicyContext = {
  caseId?: string;
  investigationId?: string;
  reasonForAccess?: string;
};

export type PolicyRequest = {
  action: GovernanceAction;
  resource: PolicyResource;
  context?: PolicyContext;
};

export type PolicyDecisionCode =
  | "ALLOW_ROLE_GRANT"
  | "DENY_UNAUTHENTICATED"
  | "DENY_PERMISSION_MISSING"
  | "DENY_SCOPE_MISMATCH"
  | "DENY_REASON_REQUIRED";

export type PolicyDecision = {
  allowed: boolean;
  code: PolicyDecisionCode;
  action: GovernanceAction;
  resource: PolicyResource;
  matchedRoleIds: string[];
};

export type PermissionGrant = {
  roleId: string;
  permission: Permission;
  scope: GovernanceScope;
};

const REASON_REQUIRED_PERMISSIONS = new Set<Permission>([
  "IDENTIFIER_USE_RESTRICTED",
  "IDENTIFIER_VIEW_RESTRICTED",
  "EVIDENCE_EXPORT",
]);

export function permissionRequiresReason(permission: Permission): boolean {
  return REASON_REQUIRED_PERMISSIONS.has(permission);
}

export function scopeMatches(
  scope: GovernanceScope,
  resource: PolicyResource,
  context: PolicyContext = {},
): boolean {
  if (scope.type === "WORKSPACE") return true;

  if (scope.type === "CASE") {
    const requestedCaseId = resource.type === "CASE" ? resource.id : context.caseId;
    return requestedCaseId === scope.resourceId;
  }

  return scope.resourceType === resource.type && scope.resourceId === resource.id;
}

export function assertPermission(value: string): asserts value is Permission {
  if (!(PERMISSIONS as readonly string[]).includes(value)) {
    throw new AppError({
      code: "GOVERNANCE_PERMISSION_INVALID",
      message: "The permission is not registered by Governance.",
      statusCode: 400,
      details: { permission: value },
    });
  }
}

export function validateRoleDefinition(input: {
  key: string;
  name: string;
  description?: string | null;
  permissions: readonly Permission[];
}): {
  key: string;
  name: string;
  description: string | null;
  permissions: Permission[];
} {
  const key = input.key.trim().toUpperCase();
  const name = input.name.trim();
  const description = input.description?.trim() || null;
  const permissions = [...new Set(input.permissions)].sort();

  for (const permission of permissions) assertPermission(permission);

  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(key)) {
    throw new AppError({
      code: "GOVERNANCE_ROLE_KEY_INVALID",
      message: "Role key must be 3-64 uppercase letters, digits, or underscores.",
      statusCode: 400,
    });
  }
  if (name.length < 2 || name.length > 120) {
    throw new AppError({
      code: "GOVERNANCE_ROLE_NAME_INVALID",
      message: "Role name must be between 2 and 120 characters.",
      statusCode: 400,
    });
  }
  if (description && description.length > 500) {
    throw new AppError({
      code: "GOVERNANCE_ROLE_DESCRIPTION_INVALID",
      message: "Role description must not exceed 500 characters.",
      statusCode: 400,
    });
  }
  if (permissions.length === 0) {
    throw new AppError({
      code: "GOVERNANCE_ROLE_PERMISSIONS_REQUIRED",
      message: "A role must contain at least one permission.",
      statusCode: 400,
    });
  }

  return { key, name, description, permissions };
}

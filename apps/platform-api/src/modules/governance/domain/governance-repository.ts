import type {
  GovernanceResourceType,
  GovernanceScope,
  GovernanceSubjectType,
  Permission,
  PermissionGrant,
  Role,
  RoleAssignment,
} from "./governance.js";

export type CreateRoleCommand = {
  workspaceId: string;
  key: string;
  name: string;
  description: string | null;
  permissions: Permission[];
};

export type CreateRoleAssignmentCommand = {
  workspaceId: string;
  roleId: string;
  subjectType: GovernanceSubjectType;
  subjectId: string;
  scope: GovernanceScope;
  grantedBySubjectType: GovernanceSubjectType;
  grantedBySubjectId: string;
};

export type FindPermissionGrantsQuery = {
  workspaceId: string;
  subjectType: GovernanceSubjectType;
  subjectId: string;
  permission: Permission;
};

export type RevokeRoleAssignmentCommand = {
  assignmentId: string;
  expectedRevision: number;
  revokedBySubjectType: GovernanceSubjectType;
  revokedBySubjectId: string;
};

export interface GovernanceRepository {
  createRole(command: CreateRoleCommand): Promise<Role>;
  createAssignment(command: CreateRoleAssignmentCommand): Promise<RoleAssignment>;
  revokeAssignment(command: RevokeRoleAssignmentCommand): Promise<RoleAssignment>;
  findPermissionGrants(query: FindPermissionGrantsQuery): Promise<PermissionGrant[]>;
}

export type PersistedScope = {
  scopeType: GovernanceScope["type"];
  scopeResourceType: GovernanceResourceType | null;
  scopeResourceId: string | null;
};

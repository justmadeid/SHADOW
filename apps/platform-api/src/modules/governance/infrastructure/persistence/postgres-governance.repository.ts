import { and, eq, sql } from "drizzle-orm";

import { DatabaseContext } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import type {
  CreateRoleAssignmentCommand,
  CreateRoleCommand,
  FindPermissionGrantsQuery,
  GovernanceRepository,
  RevokeRoleAssignmentCommand,
} from "../../domain/governance-repository.js";
import type {
  GovernanceResourceType,
  GovernanceScope,
  GovernanceSubjectType,
  Permission,
  PermissionGrant,
  Role,
  RoleAssignment,
} from "../../domain/governance.js";
import { validateRoleDefinition } from "../../domain/governance.js";
import {
  governanceAssignmentHistory,
  governanceRoleAssignments,
  governanceRolePermissions,
  governanceRoles,
} from "./governance.schema.js";

type AssignmentRow = typeof governanceRoleAssignments.$inferSelect;

export class PostgresGovernanceRepository implements GovernanceRepository {
  constructor(private readonly database: DatabaseContext) {}

  async createRole(command: CreateRoleCommand): Promise<Role> {
    const normalized = validateRoleDefinition(command);
    const now = new Date();
    const roleId = newUuid();

    try {
      await this.database.connection().insert(governanceRoles).values({
        id: roleId,
        workspaceId: command.workspaceId,
        key: normalized.key,
        name: normalized.name,
        description: normalized.description,
        status: "ACTIVE",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      await this.database
        .connection()
        .insert(governanceRolePermissions)
        .values(normalized.permissions.map((permission) => ({ roleId, permission })));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          code: "GOVERNANCE_ROLE_KEY_CONFLICT",
          message: "A Governance role with this key already exists in the Workspace.",
          statusCode: 409,
        });
      }
      throw error;
    }

    return {
      id: roleId,
      workspaceId: command.workspaceId,
      ...normalized,
      status: "ACTIVE",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  async createAssignment(command: CreateRoleAssignmentCommand): Promise<RoleAssignment> {
    const roleResult = await this.database.connection().execute(sql`
      SELECT id
      FROM governance_roles
      WHERE id = ${command.roleId}
        AND workspace_id = ${command.workspaceId}
        AND status = 'ACTIVE'
      LIMIT 1
    `);
    if (roleResult.rows.length === 0) {
      throw new AppError({
        code: "GOVERNANCE_ROLE_NOT_FOUND",
        message: "Governance role was not found.",
        statusCode: 404,
      });
    }

    const now = new Date();
    const assignmentId = newUuid();
    const persistedScope = persistScope(command.scope);
    await this.database
      .connection()
      .insert(governanceRoleAssignments)
      .values({
        id: assignmentId,
        workspaceId: command.workspaceId,
        roleId: command.roleId,
        subjectType: command.subjectType,
        subjectId: command.subjectId,
        ...persistedScope,
        status: "ACTIVE",
        revision: 1,
        grantedBySubjectType: command.grantedBySubjectType,
        grantedBySubjectId: command.grantedBySubjectId,
        grantedAt: now,
        revokedAt: null,
      });
    await this.database.connection().insert(governanceAssignmentHistory).values({
      id: newUuid(),
      assignmentId,
      workspaceId: command.workspaceId,
      action: "GRANTED",
      actorSubjectType: command.grantedBySubjectType,
      actorSubjectId: command.grantedBySubjectId,
      occurredAt: now,
    });

    return {
      id: assignmentId,
      workspaceId: command.workspaceId,
      roleId: command.roleId,
      subjectType: command.subjectType,
      subjectId: command.subjectId,
      scope: command.scope,
      status: "ACTIVE",
      revision: 1,
      grantedBySubjectType: command.grantedBySubjectType,
      grantedBySubjectId: command.grantedBySubjectId,
      grantedAt: now,
      revokedAt: null,
    };
  }

  async revokeAssignment(command: RevokeRoleAssignmentCommand): Promise<RoleAssignment> {
    const now = new Date();
    const updated = await this.database
      .connection()
      .update(governanceRoleAssignments)
      .set({
        status: "REVOKED",
        revision: sql`${governanceRoleAssignments.revision} + 1`,
        revokedAt: now,
      })
      .where(
        and(
          eq(governanceRoleAssignments.id, command.assignmentId),
          // Typed memberships must use the locked last-owner/audit command path.
          eq(governanceRoleAssignments.caseMembership, false),
          eq(governanceRoleAssignments.status, "ACTIVE"),
          eq(governanceRoleAssignments.revision, command.expectedRevision),
        ),
      )
      .returning();

    const row = updated[0];
    if (!row) {
      const existing = await this.findAssignment(command.assignmentId);
      if (!existing) {
        throw new AppError({
          code: "GOVERNANCE_ASSIGNMENT_NOT_FOUND",
          message: "Governance role assignment was not found.",
          statusCode: 404,
        });
      }
      throw new AppError({
        code: "CONFLICT_REVISION_MISMATCH",
        message: "The resource has changed since it was read.",
        statusCode: 412,
        details: {
          expectedRevision: command.expectedRevision,
          actualRevision: existing.revision,
        },
      });
    }

    await this.database.connection().insert(governanceAssignmentHistory).values({
      id: newUuid(),
      assignmentId: row.id,
      workspaceId: row.workspaceId,
      action: "REVOKED",
      actorSubjectType: command.revokedBySubjectType,
      actorSubjectId: command.revokedBySubjectId,
      occurredAt: now,
    });
    return mapAssignment(row);
  }

  async findPermissionGrants(
    query: FindPermissionGrantsQuery,
  ): Promise<PermissionGrant[]> {
    const result = await this.database.connection().execute(sql`
      SELECT
        r.id AS role_id,
        p.permission,
        (a.case_membership AND r.case_role IS NOT NULL) AS case_membership,
        a.scope_type,
        a.scope_resource_type,
        a.scope_resource_id
      FROM governance_role_assignments a
      JOIN governance_roles r
        ON r.id = a.role_id
       AND r.workspace_id = a.workspace_id
       AND r.status = 'ACTIVE'
      JOIN governance_role_permissions p
        ON p.role_id = r.id
      WHERE a.workspace_id = ${query.workspaceId}
        AND a.subject_type = ${query.subjectType}
        AND a.subject_id = ${query.subjectId}
        AND a.status = 'ACTIVE'
        AND p.permission = ${query.permission}
      ORDER BY r.id, a.id
    `);

    return result.rows.map((raw) => {
      const row = raw as {
        role_id: string;
        permission: Permission;
        case_membership: boolean;
        scope_type: GovernanceScope["type"];
        scope_resource_type: GovernanceResourceType | null;
        scope_resource_id: string | null;
      };
      return {
        roleId: row.role_id,
        permission: row.permission,
        caseMembership: row.case_membership,
        scope: restoreScope(
          row.scope_type,
          row.scope_resource_type,
          row.scope_resource_id,
        ),
      };
    });
  }

  private async findAssignment(
    assignmentId: string,
  ): Promise<RoleAssignment | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT *
      FROM governance_role_assignments
      WHERE id = ${assignmentId}
      LIMIT 1
    `);
    const raw = result.rows[0] as
      | {
          id: string;
          workspace_id: string;
          role_id: string;
          subject_type: GovernanceSubjectType;
          subject_id: string;
          scope_type: GovernanceScope["type"];
          scope_resource_type: GovernanceResourceType | null;
          scope_resource_id: string | null;
          status: "ACTIVE" | "REVOKED";
          revision: number;
          granted_by_subject_type: GovernanceSubjectType;
          granted_by_subject_id: string;
          granted_at: Date;
          revoked_at: Date | null;
        }
      | undefined;
    if (!raw) return undefined;
    return {
      id: raw.id,
      workspaceId: raw.workspace_id,
      roleId: raw.role_id,
      subjectType: raw.subject_type,
      subjectId: raw.subject_id,
      scope: restoreScope(raw.scope_type, raw.scope_resource_type, raw.scope_resource_id),
      status: raw.status,
      revision: raw.revision,
      grantedBySubjectType: raw.granted_by_subject_type,
      grantedBySubjectId: raw.granted_by_subject_id,
      grantedAt: raw.granted_at,
      revokedAt: raw.revoked_at,
    };
  }
}

function persistScope(scope: GovernanceScope): {
  scopeType: GovernanceScope["type"];
  scopeResourceType: GovernanceResourceType | null;
  scopeResourceId: string | null;
} {
  if (scope.type === "WORKSPACE") {
    return {
      scopeType: "WORKSPACE",
      scopeResourceType: null,
      scopeResourceId: null,
    };
  }
  if (scope.type === "CASE") {
    return {
      scopeType: "CASE",
      scopeResourceType: "CASE",
      scopeResourceId: scope.resourceId,
    };
  }
  return {
    scopeType: "RESOURCE",
    scopeResourceType: scope.resourceType,
    scopeResourceId: scope.resourceId,
  };
}

function restoreScope(
  scopeType: GovernanceScope["type"],
  resourceType: GovernanceResourceType | null,
  resourceId: string | null,
): GovernanceScope {
  if (scopeType === "WORKSPACE") return { type: "WORKSPACE" };
  if (!resourceId) throw new Error("Governance scope is missing its resource ID.");
  if (scopeType === "CASE") return { type: "CASE", resourceId };
  if (!resourceType) throw new Error("Governance resource scope is missing its type.");
  return { type: "RESOURCE", resourceType, resourceId };
}

function mapAssignment(row: AssignmentRow): RoleAssignment {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    roleId: row.roleId,
    subjectType: row.subjectType as GovernanceSubjectType,
    subjectId: row.subjectId,
    scope: restoreScope(
      row.scopeType as GovernanceScope["type"],
      row.scopeResourceType as GovernanceResourceType | null,
      row.scopeResourceId,
    ),
    status: row.status as RoleAssignment["status"],
    revision: row.revision,
    grantedBySubjectType: row.grantedBySubjectType as GovernanceSubjectType,
    grantedBySubjectId: row.grantedBySubjectId,
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505",
  );
}

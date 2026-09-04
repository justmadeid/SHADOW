import { and, eq, sql } from "drizzle-orm";
import { DatabaseContext } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import {
  CASE_ROLE_PERMISSIONS,
  type CaseMembership,
  type CaseMembershipStore,
  type CaseRole,
} from "../../domain/case-membership.js";
import {
  governanceRoles,
  governanceRolePermissions,
  governanceRoleAssignments,
  governanceAssignmentHistory,
} from "./governance.schema.js";

export class PostgresCaseMembershipStore implements CaseMembershipStore {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}

  async lockCase(workspaceId: string, caseId: string): Promise<void> {
    const key = `case-access:${workspaceId}:${caseId}`;
    await this.database
      .connection()
      .execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  async grant(
    workspaceId: string,
    caseId: string,
    userId: string,
    role: CaseRole,
    actorUserId: string,
    reason: string,
  ): Promise<CaseMembership> {
    await this.lockCase(workspaceId, caseId);
    const existing = await this.database.connection().execute(sql`
      SELECT a.id, a.revision, r.case_role FROM governance_role_assignments a
      JOIN governance_roles r ON r.id = a.role_id AND r.workspace_id = a.workspace_id
      WHERE a.workspace_id = ${workspaceId} AND a.scope_resource_id = ${caseId}
        AND a.subject_id = ${userId} AND a.case_membership AND a.status = 'ACTIVE'
    `);
    const previous = existing.rows[0] as
      { id: string; revision: number; case_role: CaseRole } | undefined;
    if (previous) {
      if (previous.case_role !== role)
        throw new AppError({
          code: "CASE_MEMBER_ALREADY_EXISTS",
          message: "Revoke the existing membership before assigning a different role.",
          statusCode: 409,
        });
      return {
        id: previous.id,
        revision: previous.revision,
        workspaceId,
        caseId,
        userId,
        role,
        status: "ACTIVE",
      };
    }

    // Serialize first-time role provisioning per Workspace; no duplicate role grants.
    const roleLock = `case-role:${workspaceId}`;
    await this.database
      .connection()
      .execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${roleLock}, 0))`);
    const roles = await this.database
      .connection()
      .select({ id: governanceRoles.id })
      .from(governanceRoles)
      .where(
        and(
          eq(governanceRoles.workspaceId, workspaceId),
          eq(governanceRoles.caseRole, role),
          eq(governanceRoles.status, "ACTIVE"),
        ),
      );
    let roleId = roles[0]?.id;
    const now = new Date();
    if (!roleId) {
      roleId = newUuid();
      await this.database
        .connection()
        .insert(governanceRoles)
        .values({
          id: roleId,
          workspaceId,
          key: `SYSTEM_CASE_${role}`,
          name: `Case ${role.toLowerCase()}`,
          caseRole: role,
          status: "ACTIVE",
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
      await this.database
        .connection()
        .insert(governanceRolePermissions)
        .values(
          CASE_ROLE_PERMISSIONS[role].map((permission) => ({
            roleId: roleId!,
            permission,
          })),
        );
    }
    const membership: CaseMembership = {
      id: newUuid(),
      workspaceId,
      caseId,
      userId,
      role,
      status: "ACTIVE",
      revision: 1,
    };
    await this.database.connection().insert(governanceRoleAssignments).values({
      id: membership.id,
      workspaceId,
      roleId,
      subjectType: "USER",
      subjectId: userId,
      scopeType: "CASE",
      scopeResourceType: "CASE",
      scopeResourceId: caseId,
      caseMembership: true,
      status: "ACTIVE",
      revision: 1,
      grantedBySubjectType: "USER",
      grantedBySubjectId: actorUserId,
      grantedAt: now,
    });
    await this.record(membership, "GRANTED", actorUserId, reason);
    return membership;
  }

  async revoke(
    workspaceId: string,
    caseId: string,
    membershipId: string,
    expectedRevision: number,
    actorUserId: string,
    reason: string,
  ): Promise<CaseMembership> {
    await this.lockCase(workspaceId, caseId);
    const found = await this.database.connection().execute(sql`
      SELECT a.subject_id, a.revision, a.status, r.case_role
      FROM governance_role_assignments a JOIN governance_roles r ON r.id = a.role_id AND r.workspace_id = a.workspace_id
      WHERE a.id = ${membershipId} AND a.workspace_id = ${workspaceId}
        AND a.scope_resource_id = ${caseId} AND a.case_membership
    `);
    const row = found.rows[0] as
      | { subject_id: string; revision: number; status: string; case_role: CaseRole }
      | undefined;
    if (!row)
      throw new AppError({
        code: "CASE_MEMBER_NOT_FOUND",
        message: "Case member was not found.",
        statusCode: 404,
      });
    if (row.revision !== expectedRevision || row.status !== "ACTIVE")
      throw new AppError({
        code: "CONFLICT_REVISION_MISMATCH",
        message: "The membership has changed since it was read.",
        statusCode: 412,
      });
    if (row.case_role === "OWNER") {
      const owners = await this.database.connection().execute(sql`
        SELECT count(*)::int AS count FROM governance_role_assignments a
        JOIN governance_roles r ON r.id = a.role_id AND r.workspace_id = a.workspace_id
        WHERE a.workspace_id = ${workspaceId} AND a.scope_resource_id = ${caseId}
          AND a.case_membership AND a.status = 'ACTIVE' AND r.case_role = 'OWNER' AND r.status = 'ACTIVE'
      `);
      if (Number(owners.rows[0]?.count) <= 1)
        throw new AppError({
          code: "CASE_LAST_OWNER",
          message: "The last Case owner cannot be removed.",
          statusCode: 409,
        });
    }
    await this.database
      .connection()
      .update(governanceRoleAssignments)
      .set({ status: "REVOKED", revision: expectedRevision + 1, revokedAt: new Date() })
      .where(eq(governanceRoleAssignments.id, membershipId));
    const membership: CaseMembership = {
      id: membershipId,
      workspaceId,
      caseId,
      userId: row.subject_id,
      role: row.case_role,
      status: "REVOKED",
      revision: expectedRevision + 1,
    };
    await this.record(membership, "REVOKED", actorUserId, reason);
    return membership;
  }

  async listCaseIds(
    workspaceId: string,
    userId: string,
    before?: string,
  ): Promise<string[]> {
    // Authorization is applied before the bounded keyset page, never after LIMIT.
    const result = await this.database.connection().execute(sql`
      SELECT DISTINCT a.scope_resource_id FROM governance_role_assignments a
      JOIN governance_roles r ON r.id = a.role_id AND r.workspace_id = a.workspace_id AND r.status = 'ACTIVE'
      JOIN governance_role_permissions p ON p.role_id = r.id AND p.permission = 'CASE_VIEW'
      WHERE a.workspace_id = ${workspaceId} AND a.subject_id = ${userId}
        AND a.case_membership AND a.status = 'ACTIVE' AND r.case_role IS NOT NULL
        ${before ? sql`AND a.scope_resource_id < ${before}::uuid` : sql``}
      ORDER BY a.scope_resource_id DESC LIMIT 101
    `);
    return result.rows.map((row) => String(row.scope_resource_id));
  }

  private async record(
    member: CaseMembership,
    action: "GRANTED" | "REVOKED",
    actorUserId: string,
    reason: string,
  ) {
    const historyId = newUuid();
    const now = new Date();
    await this.database.connection().insert(governanceAssignmentHistory).values({
      id: historyId,
      assignmentId: member.id,
      workspaceId: member.workspaceId,
      action,
      actorSubjectType: "USER",
      actorSubjectId: actorUserId,
      reason,
      occurredAt: now,
    });
    await this.outbox.enqueue({
      type: "CASE_MEMBERSHIP_CHANGED",
      version: 1,
      aggregate: { type: "CASE", id: member.caseId },
      payload: {
        workspaceId: member.workspaceId,
        caseId: member.caseId,
        membershipId: member.id,
        historyId,
        action,
        revision: member.revision,
      },
      occurredAt: now,
    });
  }
}

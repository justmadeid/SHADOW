import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Workspace foreign keys are owned by the SQL migration. Do not import another
// module's Drizzle table into Governance just to describe those foreign keys.

export const governanceRoles = pgTable(
  "governance_roles",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    caseRole: text("case_role"),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("governance_roles_workspace_key_uq").on(table.workspaceId, table.key),
    uniqueIndex("governance_roles_workspace_case_role_uq").on(
      table.workspaceId,
      table.caseRole,
    ),
    check(
      "governance_roles_case_role_check",
      sql`${table.caseRole} IN ('OWNER', 'EDITOR', 'VIEWER')`,
    ),
    check("governance_roles_revision_positive", sql`${table.revision} > 0`),
    check(
      "governance_roles_status_valid",
      sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`,
    ),
  ],
);

export const governanceRolePermissions = pgTable(
  "governance_role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => governanceRoles.id),
    permission: text("permission").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permission] }),
    check(
      "governance_role_permissions_permission_valid",
      sql`${table.permission} IN ('WORKSPACE_VIEW', 'WORKSPACE_MANAGE', 'CASE_CREATE', 'CASE_VIEW', 'CASE_UPDATE', 'INVESTIGATION_CREATE', 'INVESTIGATION_VIEW', 'INVESTIGATION_UPDATE', 'GOVERNANCE_ROLE_VIEW', 'GOVERNANCE_ROLE_MANAGE', 'DISCOVER_ENTITY_EXISTENCE', 'VIEW_CROSS_CASE_CONTEXT', 'VIEW_CROSS_CASE_EVIDENCE', 'IDENTIFIER_USE_RESTRICTED', 'IDENTIFIER_VIEW_RESTRICTED', 'EVIDENCE_EXPORT')`,
    ),
  ],
);

export const governanceRoleAssignments = pgTable(
  "governance_role_assignments",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    caseMembership: boolean("case_membership").notNull().default(false),
    roleId: uuid("role_id")
      .notNull()
      .references(() => governanceRoles.id),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeResourceType: text("scope_resource_type"),
    scopeResourceId: uuid("scope_resource_id"),
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(1),
    grantedBySubjectType: text("granted_by_subject_type").notNull(),
    grantedBySubjectId: text("granted_by_subject_id").notNull(),
    grantedAt: timestamp("granted_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("governance_case_membership_active_uq")
      .on(table.workspaceId, table.scopeResourceId, table.subjectId)
      .where(sql`${table.caseMembership} AND ${table.status} = 'ACTIVE'`),
    index("governance_case_membership_list_idx")
      .on(table.workspaceId, table.subjectId, table.scopeResourceId.desc())
      .where(sql`${table.caseMembership} AND ${table.status} = 'ACTIVE'`),
    check(
      "governance_case_membership_shape",
      sql`NOT ${table.caseMembership} OR (${table.subjectType} = 'USER' AND ${table.scopeType} = 'CASE')`,
    ),
    index("governance_assignments_subject_idx").on(
      table.workspaceId,
      table.subjectType,
      table.subjectId,
      table.status,
    ),
    index("governance_assignments_role_idx").on(table.roleId, table.status),
    check(
      "governance_assignments_subject_type_valid",
      sql`${table.subjectType} IN ('USER', 'SERVICE')`,
    ),
    check(
      "governance_assignments_granter_type_valid",
      sql`${table.grantedBySubjectType} IN ('USER', 'SERVICE')`,
    ),
    check(
      "governance_assignments_scope_type_valid",
      sql`${table.scopeType} IN ('WORKSPACE', 'CASE', 'RESOURCE')`,
    ),
    check(
      "governance_assignments_scope_shape_valid",
      sql`(
        (${table.scopeType} = 'WORKSPACE' AND ${table.scopeResourceType} IS NULL AND ${table.scopeResourceId} IS NULL)
        OR (${table.scopeType} = 'CASE' AND ${table.scopeResourceType} = 'CASE' AND ${table.scopeResourceId} IS NOT NULL)
        OR (${table.scopeType} = 'RESOURCE' AND ${table.scopeResourceType} IS NOT NULL AND ${table.scopeResourceId} IS NOT NULL)
      )`,
    ),
    check(
      "governance_assignments_resource_type_valid",
      sql`${table.scopeResourceType} IS NULL OR ${table.scopeResourceType} IN ('WORKSPACE', 'CASE', 'INVESTIGATION', 'ENTITY', 'EVIDENCE', 'IDENTIFIER', 'EXPORT', 'GOVERNANCE')`,
    ),
    check(
      "governance_assignments_status_valid",
      sql`${table.status} IN ('ACTIVE', 'REVOKED')`,
    ),
    check("governance_assignments_revision_positive", sql`${table.revision} > 0`),
  ],
);

export const governanceAssignmentHistory = pgTable(
  "governance_assignment_history",
  {
    id: uuid("id").primaryKey(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => governanceRoleAssignments.id),
    workspaceId: uuid("workspace_id").notNull(),
    reason: text("reason"),
    action: text("action").notNull(),
    actorSubjectType: text("actor_subject_type").notNull(),
    actorSubjectId: text("actor_subject_id").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    check(
      "governance_assignment_history_reason_check",
      sql`${table.reason} IS NULL OR char_length(${table.reason}) BETWEEN 1 AND 1000`,
    ),
    index("governance_assignment_history_workspace_idx").on(
      table.workspaceId,
      table.occurredAt,
    ),
    check(
      "governance_assignment_history_action_valid",
      sql`${table.action} IN ('GRANTED', 'REVOKED')`,
    ),
    check(
      "governance_assignment_history_actor_type_valid",
      sql`${table.actorSubjectType} IN ('USER', 'SERVICE')`,
    ),
  ],
);

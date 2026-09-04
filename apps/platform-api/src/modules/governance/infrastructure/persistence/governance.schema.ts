import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { workspaces } from "../../../workspace/infrastructure/persistence/workspace.schema.js";

export const governanceRoles = pgTable(
  "governance_roles",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
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
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
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
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    action: text("action").notNull(),
    actorSubjectType: text("actor_subject_type").notNull(),
    actorSubjectId: text("actor_subject_id").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
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

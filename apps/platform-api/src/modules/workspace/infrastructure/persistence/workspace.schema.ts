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
import { sql } from "drizzle-orm";

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(1),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("workspaces_slug_uq").on(table.slug),
    check("workspaces_revision_positive", sql`${table.revision} > 0`),
    check("workspaces_status_valid", sql`${table.status} IN ('ACTIVE', 'ARCHIVED')`),
  ],
);

export const workspaceSettings = pgTable("workspace_settings", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id),
  locale: text("locale").notNull(),
  timeZone: text("time_zone").notNull(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(1),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" }).notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("workspace_members_workspace_user_uq").on(
      table.workspaceId,
      table.userId,
    ),
    index("workspace_members_user_status_idx").on(table.userId, table.status),
    check("workspace_members_revision_positive", sql`${table.revision} > 0`),
    check(
      "workspace_members_status_valid",
      sql`${table.status} IN ('ACTIVE', 'REMOVED')`,
    ),
  ],
);

export const workspaceMembershipHistory = pgTable(
  "workspace_membership_history",
  {
    id: uuid("id").primaryKey(),
    workspaceMemberId: uuid("workspace_member_id")
      .notNull()
      .references(() => workspaceMembers.id),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id").notNull(),
    action: text("action").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    reason: text("reason").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("workspace_membership_history_workspace_time_idx").on(
      table.workspaceId,
      table.occurredAt,
    ),
    check(
      "workspace_membership_history_action_valid",
      sql`${table.action} IN ('ADDED', 'REMOVED')`,
    ),
  ],
);

export const workspaceIdempotency = pgTable(
  "workspace_idempotency",
  {
    userId: text("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.idempotencyKey] })],
);

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

export const investigations = pgTable(
  "investigations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    caseId: uuid("case_id").notNull(),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(1),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("investigations_case_updated_idx").on(table.caseId, table.updatedAt),
    index("investigations_workspace_case_idx").on(table.workspaceId, table.caseId),
    check("investigations_revision_positive", sql`${table.revision} > 0`),
    check(
      "investigations_title_length",
      sql`char_length(${table.title}) BETWEEN 3 AND 200`,
    ),
    check(
      "investigations_objective_length",
      sql`char_length(${table.objective}) BETWEEN 3 AND 2000`,
    ),
    check(
      "investigations_status_valid",
      sql`${table.status} IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')`,
    ),
  ],
);

export const investigationIdempotency = pgTable(
  "investigation_idempotency",
  {
    userId: text("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.idempotencyKey] }),
    uniqueIndex("investigation_idempotency_investigation_uq").on(table.investigationId),
  ],
);

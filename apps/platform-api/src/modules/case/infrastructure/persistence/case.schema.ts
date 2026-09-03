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

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull(),
    classification: text("classification").notNull(),
    revision: integer("revision").notNull().default(1),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("cases_code_uq").on(table.code),
    index("cases_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    index("cases_workspace_status_idx").on(table.workspaceId, table.status),
    check("cases_revision_positive", sql`${table.revision} > 0`),
    check("cases_title_length", sql`char_length(${table.title}) BETWEEN 3 AND 200`),
    check(
      "cases_description_length",
      sql`${table.description} IS NULL OR char_length(${table.description}) <= 4000`,
    ),
    check(
      "cases_status_valid",
      sql`${table.status} IN ('DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED')`,
    ),
    check(
      "cases_classification_valid",
      sql`${table.classification} IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')`,
    ),
  ],
);

export const caseIdempotency = pgTable(
  "case_idempotency",
  {
    userId: text("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.idempotencyKey] })],
);

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import type { JsonObject } from "../../domain/outbox-event.js";

export const platformOutboxEvents = pgTable(
  "platform_outbox_events",
  {
    id: uuid("id").primaryKey(),

    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull(),

    aggregateType: text("aggregate_type"),
    aggregateId: text("aggregate_id"),

    payload: jsonb("payload").$type<JsonObject>().notNull(),

    requestId: text("request_id"),
    traceParent: text("trace_parent"),

    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    availableAt: timestamp("available_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    attemptCount: integer("attempt_count").notNull().default(0),

    leaseOwner: text("lease_owner"),
    leasedUntil: timestamp("leased_until", {
      withTimezone: true,
      mode: "date",
    }),

    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),

    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at", {
      withTimezone: true,
      mode: "date",
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    index("platform_outbox_pending_idx")
      .on(table.availableAt, table.occurredAt, table.id)
      .where(sql`${table.publishedAt} is null`),

    index("platform_outbox_lease_idx")
      .on(table.leasedUntil)
      .where(sql`${table.publishedAt} is null`),
  ],
);

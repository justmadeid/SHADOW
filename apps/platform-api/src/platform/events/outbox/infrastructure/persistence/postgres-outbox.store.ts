import { sql } from "drizzle-orm";
import { context, trace } from "@opentelemetry/api";

import { DatabaseContext } from "@intelligence/database";
import { newUuid } from "../../../../ids/uuid.js";
import { RequestContextStore } from "../../../../request-context/index.js";
import type {
  JsonObject,
  OutboxEventInput,
  OutboxEventRecord,
} from "../../domain/outbox-event.js";
import { assertSafeOutboxPayload } from "../../domain/outbox-payload-policy.js";
import type { OutboxStore } from "../../domain/outbox-store.js";
import { platformOutboxEvents } from "./outbox.schema.js";

type OutboxRow = {
  id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: JsonObject;
  request_id: string | null;
  trace_parent: string | null;
  occurred_at: Date;
  available_at: Date;
  attempt_count: number;
  lease_owner: string | null;
  leased_until: Date | null;
  published_at: Date | null;
  last_error_code: string | null;
  last_error_at: Date | null;
};

export class PostgresOutboxStore implements OutboxStore {
  constructor(
    private readonly database: DatabaseContext,
    private readonly requestContext: RequestContextStore,
  ) {}

  async enqueue<TPayload extends JsonObject>(
    event: OutboxEventInput<TPayload>,
  ): Promise<string> {
    assertSafeOutboxPayload(event.payload);

    if (!Number.isSafeInteger(event.version) || event.version <= 0) {
      throw new Error("Outbox event version must be a positive integer");
    }

    const id = newUuid();
    const now = new Date();
    const request = this.requestContext.getOptional();

    await this.database
      .connection()
      .insert(platformOutboxEvents)
      .values({
        id,

        eventType: event.type,
        eventVersion: event.version,

        aggregateType: event.aggregate?.type ?? null,
        aggregateId: event.aggregate?.id ?? null,

        payload: event.payload,

        requestId: request?.requestId ?? null,
        traceParent: currentTraceParent(),

        occurredAt: event.occurredAt ?? now,
        availableAt: event.availableAt ?? now,

        attemptCount: 0,

        leaseOwner: null,
        leasedUntil: null,
        publishedAt: null,

        lastErrorCode: null,
        lastErrorAt: null,

        createdAt: now,
      });

    return id;
  }

  async claim(options: {
    leaseOwner: string;
    batchSize: number;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<OutboxEventRecord[]> {
    const batchSize = clampInteger(options.batchSize, 1, 500);
    const leaseDurationMs = clampInteger(options.leaseDurationMs, 1_000, 15 * 60_000);
    const now = options.now ?? new Date();
    const leasedUntil = new Date(now.getTime() + leaseDurationMs);

    const result = await this.database.connection().execute(sql`
      WITH candidates AS (
        SELECT id
        FROM platform_outbox_events
        WHERE published_at IS NULL
          AND available_at <= ${now}
          AND (
            leased_until IS NULL
            OR leased_until <= ${now}
          )
        ORDER BY available_at ASC, occurred_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE platform_outbox_events AS outbox
      SET
        lease_owner = ${options.leaseOwner},
        leased_until = ${leasedUntil},
        attempt_count = outbox.attempt_count + 1
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING
        outbox.id,
        outbox.event_type,
        outbox.event_version,
        outbox.aggregate_type,
        outbox.aggregate_id,
        outbox.payload,
        outbox.request_id,
        outbox.trace_parent,
        outbox.occurred_at,
        outbox.available_at,
        outbox.attempt_count,
        outbox.lease_owner,
        outbox.leased_until,
        outbox.published_at,
        outbox.last_error_code,
        outbox.last_error_at
    `);

    return (result.rows as OutboxRow[]).map(mapRow);
  }

  async markPublished(options: {
    id: string;
    leaseOwner: string;
    publishedAt?: Date;
  }): Promise<boolean> {
    const publishedAt = options.publishedAt ?? new Date();

    const result = await this.database.connection().execute(sql`
      UPDATE platform_outbox_events
      SET
        published_at = ${publishedAt},
        lease_owner = NULL,
        leased_until = NULL,
        last_error_code = NULL,
        last_error_at = NULL
      WHERE id = ${options.id}
        AND published_at IS NULL
        AND lease_owner = ${options.leaseOwner}
      RETURNING id
    `);

    return result.rows.length === 1;
  }

  async markFailed(options: {
    id: string;
    leaseOwner: string;
    errorCode: string;
    nextAvailableAt: Date;
    failedAt?: Date;
  }): Promise<boolean> {
    const failedAt = options.failedAt ?? new Date();

    const result = await this.database.connection().execute(sql`
      UPDATE platform_outbox_events
      SET
        available_at = ${options.nextAvailableAt},
        lease_owner = NULL,
        leased_until = NULL,
        last_error_code = ${sanitizeErrorCode(options.errorCode)},
        last_error_at = ${failedAt}
      WHERE id = ${options.id}
        AND published_at IS NULL
        AND lease_owner = ${options.leaseOwner}
      RETURNING id
    `);

    return result.rows.length === 1;
  }
}

function currentTraceParent(): string | null {
  const spanContext = trace.getSpan(context.active())?.spanContext();

  if (!spanContext) {
    return null;
  }

  const flags = spanContext.traceFlags.toString(16).padStart(2, "0");

  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

function mapRow(row: OutboxRow): OutboxEventRecord {
  return {
    id: row.id,

    type: row.event_type,
    version: row.event_version,

    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,

    payload: row.payload,

    requestId: row.request_id,
    traceParent: row.trace_parent,

    occurredAt: row.occurred_at,
    availableAt: row.available_at,

    attemptCount: row.attempt_count,

    leaseOwner: row.lease_owner,
    leasedUntil: row.leased_until,

    publishedAt: row.published_at,

    lastErrorCode: row.last_error_code,
    lastErrorAt: row.last_error_at,
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.floor(value)));
}

function sanitizeErrorCode(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]/g, "_")
    .slice(0, 128);

  return normalized || "OUTBOX_PUBLISH_FAILED";
}

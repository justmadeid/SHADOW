import { sql } from "drizzle-orm";
import { DatabaseContext, currentTransaction } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import type { AuditEvent, AuditStore } from "../../domain/audit-event.js";

export class PostgresAuditStore implements AuditStore {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}
  async append(event: AuditEvent): Promise<string> {
    if (!currentTransaction())
      throw new Error("Audit persistence requires a transaction.");
    const connection = this.database.connection();
    const inserted = await connection.execute(sql`
      INSERT INTO audit_events (id, version, operation_id, action, outcome, workspace_id, case_id,
        resource_type, resource_id, actor_type, actor_id, request_id, trace_id, reason,
        classification, membership_id, resource_revision, occurred_at)
      VALUES (${event.id}, 1, ${event.operationId}, ${event.action}, ${event.outcome}, ${event.workspaceId}, ${event.caseId},
        ${event.resourceType}, ${event.resourceId}, ${event.actorType}, ${event.actorId}, ${event.requestId}, ${event.traceId}, ${event.reason},
        ${event.classification}, ${event.membershipId}, ${event.resourceRevision}, ${event.occurredAt})
      ON CONFLICT (workspace_id, operation_id, action, outcome) DO NOTHING RETURNING id
    `);
    if (!inserted.rows.length) {
      const existing = await connection.execute(sql`SELECT id,
        (ROW(case_id, resource_type, resource_id, actor_type, actor_id, reason, classification, membership_id, resource_revision)
         IS NOT DISTINCT FROM ROW(${event.caseId}::uuid, ${event.resourceType}::text, ${event.resourceId}::uuid, ${event.actorType}::text, ${event.actorId}::text, ${event.reason}::text, ${event.classification}::text, ${event.membershipId}::uuid, ${event.resourceRevision}::integer)) AS same
        FROM audit_events
        WHERE workspace_id = ${event.workspaceId} AND operation_id = ${event.operationId} AND action = ${event.action} AND outcome = ${event.outcome}`);
      if (existing.rows[0]?.same !== true)
        throw new AppError({
          code: "AUDIT_OPERATION_CONFLICT",
          message: "Audit operation identity was reused with different content.",
          statusCode: 409,
        });
      return String(existing.rows[0].id);
    }
    await this.outbox.enqueue({
      type: "AUDIT_EVENT_RECORDED",
      version: 1,
      aggregate: { type: "AUDIT_EVENT", id: event.id },
      payload: { auditEventId: event.id, workspaceId: event.workspaceId },
      occurredAt: event.occurredAt,
    });
    return event.id;
  }
}

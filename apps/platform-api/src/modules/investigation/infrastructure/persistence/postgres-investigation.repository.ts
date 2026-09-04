import { and, eq, sql } from "drizzle-orm";

import { DatabaseContext } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import type {
  CreateInvestigationCommand,
  CreateInvestigationResult,
  InvestigationRepository,
  UpdateInvestigationCommand,
} from "../../domain/investigation-repository.js";
import type { Investigation } from "../../domain/investigation.js";
import { investigationIdempotency, investigations } from "./investigation.schema.js";

export class PostgresInvestigationRepository implements InvestigationRepository {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}

  async create(command: CreateInvestigationCommand): Promise<CreateInvestigationResult> {
    const connection = this.database.connection();
    const lockKey = `investigation-create:${command.actorUserId}:${command.idempotencyKey}`;
    await connection.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );

    const replay = await connection.execute(sql`
      SELECT request_hash, investigation_id
      FROM investigation_idempotency
      WHERE user_id = ${command.actorUserId}
        AND idempotency_key = ${command.idempotencyKey}
    `);
    const replayRow = replay.rows[0] as
      { request_hash: string; investigation_id: string } | undefined;
    if (replayRow) {
      if (replayRow.request_hash !== command.requestHash) {
        throw new AppError({
          code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency-Key was already used with a different request.",
          statusCode: 409,
        });
      }
      const existing = await this.findById(replayRow.investigation_id);
      if (!existing) throw new Error("Investigation idempotency record is invalid.");
      return { investigation: existing, replayed: true };
    }

    const now = new Date();
    const id = newUuid();
    await connection.insert(investigations).values({
      id,
      workspaceId: command.workspaceId,
      caseId: command.caseId,
      title: command.title,
      objective: command.objective,
      status: "ACTIVE",
      revision: 1,
      createdByUserId: command.actorUserId,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      archivedAt: null,
    });
    await connection.insert(investigationIdempotency).values({
      userId: command.actorUserId,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      investigationId: id,
      createdAt: now,
    });
    await this.outbox.enqueue({
      type: "INVESTIGATION_CREATED",
      version: 1,
      aggregate: { type: "INVESTIGATION", id },
      payload: {
        investigationId: id,
        workspaceId: command.workspaceId,
        caseId: command.caseId,
        revision: 1,
      },
      occurredAt: now,
    });

    return {
      investigation: {
        id,
        workspaceId: command.workspaceId,
        caseId: command.caseId,
        title: command.title,
        objective: command.objective,
        status: "ACTIVE",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archivedAt: null,
      },
      replayed: false,
    };
  }

  async listByCase(
    workspaceId: string,
    caseId: string,
    limit: number,
  ): Promise<Investigation[]> {
    const result = await this.database.connection().execute(sql`
      SELECT id, workspace_id, case_id, title, objective, status, revision,
             created_at, updated_at, completed_at, archived_at
      FROM investigations
      WHERE workspace_id = ${workspaceId} AND case_id = ${caseId}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${Math.max(1, Math.min(100, Math.floor(limit)))}
    `);
    return (result.rows as InvestigationRow[]).map(mapRow);
  }

  async findById(investigationId: string): Promise<Investigation | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT id, workspace_id, case_id, title, objective, status, revision,
             created_at, updated_at, completed_at, archived_at
      FROM investigations
      WHERE id = ${investigationId}
      LIMIT 1
    `);
    const row = result.rows[0] as InvestigationRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  async update(command: UpdateInvestigationCommand): Promise<Investigation> {
    const now = new Date();
    const targetStatus = command.changes.status;
    const result = await this.database
      .connection()
      .update(investigations)
      .set({
        ...(command.changes.title === undefined ? {} : { title: command.changes.title }),
        ...(command.changes.objective === undefined
          ? {}
          : { objective: command.changes.objective }),
        ...(targetStatus === undefined ? {} : { status: targetStatus }),
        ...(targetStatus === "COMPLETED" ? { completedAt: now } : {}),
        ...(targetStatus === "ACTIVE" ? { completedAt: null } : {}),
        ...(targetStatus === "ARCHIVED" ? { archivedAt: now } : {}),
        revision: sql`${investigations.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(investigations.id, command.investigationId),
          eq(investigations.workspaceId, command.workspaceId),
          eq(investigations.caseId, command.caseId),
          eq(investigations.revision, command.expectedRevision),
        ),
      )
      .returning();
    const row = result[0];
    if (!row)
      return this.revisionMismatch(command.investigationId, command.expectedRevision);

    await this.outbox.enqueue({
      type: "INVESTIGATION_UPDATED",
      version: 1,
      aggregate: { type: "INVESTIGATION", id: command.investigationId },
      payload: {
        investigationId: command.investigationId,
        workspaceId: command.workspaceId,
        caseId: command.caseId,
        revision: row.revision,
        changedFields: Object.keys(command.changes).sort(),
      },
      occurredAt: now,
    });
    return mapDrizzleRow(row);
  }

  private async revisionMismatch(id: string, expectedRevision: number): Promise<never> {
    const current = await this.findById(id);
    if (!current) {
      throw new AppError({
        code: "INVESTIGATION_NOT_FOUND",
        message: "Investigation was not found.",
        statusCode: 404,
      });
    }
    throw new AppError({
      code: "CONFLICT_REVISION_MISMATCH",
      message: "The resource has changed since it was read.",
      statusCode: 412,
      details: { expectedRevision, actualRevision: current.revision },
    });
  }
}

type InvestigationRow = {
  id: string;
  workspace_id: string;
  case_id: string;
  title: string;
  objective: string;
  status: Investigation["status"];
  revision: number;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
  archived_at: string | Date | null;
};

function mapRow(row: InvestigationRow): Investigation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    caseId: row.case_id,
    title: row.title,
    objective: row.objective,
    status: row.status,
    revision: row.revision,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at === null ? null : new Date(row.completed_at),
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
  };
}

function mapDrizzleRow(row: typeof investigations.$inferSelect): Investigation {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    caseId: row.caseId,
    title: row.title,
    objective: row.objective,
    status: row.status as Investigation["status"],
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    archivedAt: row.archivedAt,
  };
}

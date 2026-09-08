import { sql } from "drizzle-orm";
import { DatabaseContext, currentTransaction } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import type {
  CancelRunCommand,
  CreateRunCommand,
  CreateRunResult,
  RunRepository,
} from "../../domain/run-repository.js";
import type { Run, RunInputSnapshot, RunStatus, RunTrigger } from "../../domain/run.js";

const CANCELLABLE_STATUSES: readonly RunStatus[] = ["QUEUED", "RUNNING"];

export class PostgresRunRepository implements RunRepository {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}

  async create(command: CreateRunCommand): Promise<CreateRunResult> {
    this.requireTransaction();
    const db = this.database.connection();
    const lock = `run-create:${command.triggeredByUserId}:${command.idempotencyKey}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);

    const replay = await db.execute(sql`
      SELECT request_hash, run_id FROM run_idempotency
      WHERE user_id = ${command.triggeredByUserId} AND idempotency_key = ${command.idempotencyKey}
    `);
    const replayRow = replay.rows[0] as
      { request_hash: string; run_id: string } | undefined;
    if (replayRow) {
      if (replayRow.request_hash !== command.requestHash)
        throw new AppError({
          code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency-Key was already used with a different request.",
          statusCode: 409,
        });
      const existing = await this.find(replayRow.run_id);
      if (!existing) throw new Error("Run idempotency record is invalid.");
      return { run: existing, replayed: true };
    }

    const id = newUuid();
    const now = new Date();
    await db.execute(sql`
      INSERT INTO runs
        (id, workspace_id, case_id, investigation_id, node_instance_id, node_definition_key,
         node_definition_version, input_snapshot, status, trigger, triggered_by_user_id,
         parent_run_id, retry_of, revision, created_at, updated_at, started_at, completed_at)
      VALUES (
        ${id}, ${command.workspaceId}, ${command.caseId}, ${command.investigationId},
        ${command.nodeInstanceId}, ${command.nodeDefinitionKey}, ${command.nodeDefinitionVersion},
        ${JSON.stringify(command.inputSnapshot)}::jsonb, 'QUEUED', ${command.trigger},
        ${command.triggeredByUserId}, NULL, ${command.retryOf ?? null}, 1, ${now}, ${now}, NULL, NULL
      )
    `);
    await db.execute(sql`
      INSERT INTO run_idempotency (user_id, idempotency_key, request_hash, run_id)
      VALUES (${command.triggeredByUserId}, ${command.idempotencyKey}, ${command.requestHash}, ${id})
    `);
    const run: Run = Object.freeze({
      id,
      workspaceId: command.workspaceId,
      caseId: command.caseId,
      investigationId: command.investigationId,
      nodeInstanceId: command.nodeInstanceId,
      nodeDefinitionKey: command.nodeDefinitionKey,
      nodeDefinitionVersion: command.nodeDefinitionVersion,
      inputSnapshot: command.inputSnapshot,
      status: "QUEUED",
      trigger: command.trigger,
      triggeredByUserId: command.triggeredByUserId,
      parentRunId: null,
      retryOf: command.retryOf ?? null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    });
    await this.record(run, command.triggeredByUserId, "RUN_CREATED");
    return { run, replayed: false };
  }

  async find(id: string): Promise<Run | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT * FROM runs WHERE id = ${id} LIMIT 1
    `);
    const row = result.rows[0] as RunRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  async listByCase(
    workspaceId: string,
    caseId: string,
    limit: number,
    before?: string,
  ): Promise<Run[]> {
    const bound = Math.max(1, Math.min(101, Math.floor(limit)));
    const result = await this.database.connection().execute(sql`
      SELECT * FROM runs
      WHERE workspace_id = ${workspaceId} AND case_id = ${caseId}
      ${before ? sql`AND id < ${before}::uuid` : sql``}
      ORDER BY id DESC LIMIT ${bound}
    `);
    return (result.rows as RunRow[]).map(mapRow);
  }

  async cancel(command: CancelRunCommand): Promise<Run> {
    this.requireTransaction();
    const now = new Date();
    const result = await this.database.connection().execute(sql`
      UPDATE runs
      SET status = 'CANCELLED', revision = revision + 1, updated_at = ${now}
      WHERE id = ${command.runId} AND revision = ${command.expectedRevision}
        AND status IN ('QUEUED', 'RUNNING')
      RETURNING *
    `);
    const row = result.rows[0] as RunRow | undefined;
    if (!row) return this.cancelFailed(command.runId, command.expectedRevision);
    const run = mapRow(row);
    await this.record(run, command.actorUserId, "RUN_CANCELLED");
    return run;
  }

  private async record(run: Run, actorUserId: string, type: string): Promise<void> {
    await this.database.connection().execute(sql`
      INSERT INTO run_revisions (run_id, revision, status, actor_user_id, occurred_at)
      VALUES (${run.id}, ${run.revision}, ${run.status}, ${actorUserId}, ${run.updatedAt})
    `);
    // Outbox payload is metadata-only: IDs, revision and enum values. Never
    // raw configuration/binding values from the Run's inputSnapshot.
    await this.outbox.enqueue({
      type,
      version: 1,
      aggregate: { type: "RUN", id: run.id },
      payload: {
        runId: run.id,
        workspaceId: run.workspaceId,
        caseId: run.caseId,
        investigationId: run.investigationId,
        nodeInstanceId: run.nodeInstanceId,
        revision: run.revision,
      },
      occurredAt: run.updatedAt,
    });
  }

  private async cancelFailed(runId: string, expectedRevision: number): Promise<never> {
    const current = await this.find(runId);
    if (!current)
      throw new AppError({
        code: "RUN_NOT_FOUND",
        message: "Run was not found.",
        statusCode: 404,
      });
    if (!CANCELLABLE_STATUSES.includes(current.status))
      throw new AppError({
        code: "RUN_INVALID_STATUS_TRANSITION",
        message: "Only a QUEUED or RUNNING Run can be cancelled.",
        statusCode: 409,
        details: { currentStatus: current.status },
      });
    throw new AppError({
      code: "CONFLICT_REVISION_MISMATCH",
      message: "The resource has changed since it was read.",
      statusCode: 412,
      details: { expectedRevision, actualRevision: current.revision },
    });
  }

  private requireTransaction(): void {
    if (!currentTransaction()) throw new Error("Run writes require a transaction.");
  }
}

type RunRow = {
  id: string;
  workspace_id: string;
  case_id: string;
  investigation_id: string;
  node_instance_id: string;
  node_definition_key: string;
  node_definition_version: number;
  input_snapshot: RunInputSnapshot;
  status: RunStatus;
  trigger: RunTrigger;
  triggered_by_user_id: string;
  parent_run_id: string | null;
  retry_of: string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
};

function mapRow(row: RunRow): Run {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspace_id,
    caseId: row.case_id,
    investigationId: row.investigation_id,
    nodeInstanceId: row.node_instance_id,
    nodeDefinitionKey: row.node_definition_key,
    nodeDefinitionVersion: row.node_definition_version,
    inputSnapshot: Object.freeze({
      configuration: Object.freeze({ ...row.input_snapshot.configuration }),
      inputBindings: Object.freeze(
        row.input_snapshot.inputBindings.map((binding) => Object.freeze({ ...binding })),
      ),
    }),
    status: row.status,
    trigger: row.trigger,
    triggeredByUserId: row.triggered_by_user_id,
    parentRunId: row.parent_run_id,
    retryOf: row.retry_of,
    revision: row.revision,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    startedAt: row.started_at === null ? null : new Date(row.started_at),
    completedAt: row.completed_at === null ? null : new Date(row.completed_at),
  });
}

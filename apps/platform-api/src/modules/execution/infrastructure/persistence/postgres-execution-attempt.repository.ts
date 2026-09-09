import { sql } from "drizzle-orm";
import { DatabaseContext, currentTransaction } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import type {
  CompleteAttemptCommand,
  CompleteAttemptResult,
  CreateAttemptCommand,
  CreateAttemptResult,
  ExecutionAttemptRepository,
  FailAttemptCommand,
  FailAttemptResult,
  RecordProgressCommand,
} from "../../domain/execution-attempt-repository.js";
import {
  createExecutionAttempt,
  failAttempt,
  isAttemptActive,
  isAttemptLeaseExpired,
  markAttemptLost,
  recordAttemptProgress,
  succeedAttempt,
  type AttemptProgress,
  type AttemptStatus,
  type ExecutionAttempt,
} from "../../domain/execution-attempt.js";
import {
  isRunTerminal,
  requeueRun,
  startRun,
  terminateRun,
  type Run,
  type RunInputSnapshot,
  type RunStatus,
  type RunTrigger,
} from "../../domain/run.js";

export class PostgresExecutionAttemptRepository implements ExecutionAttemptRepository {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}

  async create(command: CreateAttemptCommand): Promise<CreateAttemptResult> {
    this.requireTransaction();
    const db = this.database.connection();
    const now = new Date();

    const lock = `execution-attempt-create:${command.workerIdentity}:${command.idempotencyKey}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);

    const replay = await db.execute(sql`
      SELECT request_hash, attempt_id FROM execution_attempt_idempotency
      WHERE worker_identity = ${command.workerIdentity} AND idempotency_key = ${command.idempotencyKey}
    `);
    const replayRow = replay.rows[0] as
      { request_hash: string; attempt_id: string } | undefined;
    if (replayRow) {
      if (replayRow.request_hash !== command.requestHash)
        throw new AppError({
          code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency-Key was already used with a different request.",
          statusCode: 409,
        });
      const attempt = await this.find(replayRow.attempt_id);
      const run = await this.findRun(command.runId);
      if (!attempt || !run)
        throw new Error("ExecutionAttempt idempotency record is invalid.");
      return { attempt, run, replayed: true };
    }

    const runRow = await db.execute(sql`
      SELECT * FROM runs WHERE id = ${command.runId} FOR UPDATE
    `);
    const run = mapRunRow(runRow.rows[0] as RunRow | undefined);
    if (!run)
      throw new AppError({
        code: "RUN_NOT_FOUND",
        message: "Run was not found.",
        statusCode: 404,
      });
    if (isRunTerminal(run.status))
      throw new AppError({
        code: "RUN_NOT_ATTEMPTABLE",
        message: "Only a QUEUED or RUNNING Run can accept a new attempt.",
        statusCode: 409,
        details: { currentStatus: run.status },
      });

    const lastRow = await db.execute(sql`
      SELECT * FROM execution_attempts WHERE run_id = ${command.runId}
      ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE
    `);
    let last = mapAttemptRow(lastRow.rows[0] as AttemptRow | undefined);

    if (last && (last.status === "LEASED" || last.status === "RUNNING")) {
      if (isAttemptActive(last, now))
        throw new AppError({
          code: "RUN_ATTEMPT_ALREADY_ACTIVE",
          message: "The Run already has a live ExecutionAttempt.",
          statusCode: 409,
        });
      if (isAttemptLeaseExpired(last, now)) {
        const lost = markAttemptLost(last, now);
        await this.updateAttempt(lost);
        last = lost;
      }
    }

    const attemptNumber = (last?.attemptNumber ?? 0) + 1;
    const attempt = createExecutionAttempt(
      {
        id: newUuid(),
        runId: run.id,
        workspaceId: run.workspaceId,
        caseId: run.caseId,
        attemptNumber,
        workerIdentity: command.workerIdentity,
        leaseOwner: command.leaseOwner,
        leaseDurationSeconds: command.leaseDurationSeconds,
      },
      now,
    );
    await db.execute(sql`
      INSERT INTO execution_attempts
        (id, run_id, workspace_id, case_id, attempt_number, worker_identity, lease_owner,
         lease_duration_seconds, leased_until, status, error_code, retryable, last_progress,
         started_at, heartbeat_at, completed_at, revision, created_at, updated_at)
      VALUES (
        ${attempt.id}, ${attempt.runId}, ${attempt.workspaceId}, ${attempt.caseId},
        ${attempt.attemptNumber}, ${attempt.workerIdentity}, ${attempt.leaseOwner},
        ${attempt.leaseDurationSeconds}, ${attempt.leasedUntil}, ${attempt.status}, NULL, NULL, NULL,
        ${attempt.startedAt}, ${attempt.heartbeatAt}, NULL, ${attempt.revision}, ${attempt.createdAt},
        ${attempt.updatedAt}
      )
    `);

    let resultRun = run;
    if (run.status === "QUEUED") {
      resultRun = startRun(run, now);
      await this.updateRun(resultRun);
      await this.recordRunHistory(resultRun, command.workerIdentity);
    }

    await db.execute(sql`
      INSERT INTO execution_attempt_idempotency (worker_identity, idempotency_key, request_hash, attempt_id)
      VALUES (${command.workerIdentity}, ${command.idempotencyKey}, ${command.requestHash}, ${attempt.id})
    `);

    // Outbox payload is metadata-only: IDs, attemptNumber and revision.
    await this.outbox.enqueue({
      type: "RUN_ATTEMPT_CREATED",
      version: 1,
      aggregate: { type: "EXECUTION_ATTEMPT", id: attempt.id },
      payload: {
        runId: run.id,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        revision: attempt.revision,
      },
      occurredAt: attempt.createdAt,
    });

    return { attempt, run: resultRun, replayed: false };
  }

  async findActive(runId: string, now: Date): Promise<ExecutionAttempt | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT * FROM execution_attempts
      WHERE run_id = ${runId} AND status IN ('LEASED', 'RUNNING')
      ORDER BY attempt_number DESC LIMIT 1
    `);
    const attempt = mapAttemptRow(result.rows[0] as AttemptRow | undefined);
    return attempt && isAttemptActive(attempt, now) ? attempt : undefined;
  }

  async find(id: string): Promise<ExecutionAttempt | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT * FROM execution_attempts WHERE id = ${id} LIMIT 1
    `);
    return mapAttemptRow(result.rows[0] as AttemptRow | undefined);
  }

  async findRun(runId: string): Promise<Run | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT * FROM runs WHERE id = ${runId} LIMIT 1
    `);
    return mapRunRow(result.rows[0] as RunRow | undefined);
  }

  async recordProgress(
    command: RecordProgressCommand,
    now: Date,
  ): Promise<ExecutionAttempt> {
    this.requireTransaction();
    const db = this.database.connection();
    const row = await db.execute(sql`
      SELECT * FROM execution_attempts
      WHERE id = ${command.attemptId} AND run_id = ${command.runId}
      FOR UPDATE
    `);
    const current = mapAttemptRow(row.rows[0] as AttemptRow | undefined);
    if (!current)
      throw new AppError({
        code: "EXECUTION_ATTEMPT_NOT_FOUND",
        message: "ExecutionAttempt was not found.",
        statusCode: 404,
      });
    const updated = recordAttemptProgress(
      current,
      {
        stage: command.stage,
        processed: command.processed,
        produced: command.produced,
        total: command.total,
      },
      now,
    );
    await this.updateAttempt(updated);
    return updated;
  }

  async complete(
    command: CompleteAttemptCommand,
    now: Date,
  ): Promise<CompleteAttemptResult> {
    this.requireTransaction();
    const db = this.database.connection();
    const attemptRow = await db.execute(sql`
      SELECT * FROM execution_attempts
      WHERE id = ${command.attemptId} AND run_id = ${command.runId}
      FOR UPDATE
    `);
    const attempt = mapAttemptRow(attemptRow.rows[0] as AttemptRow | undefined);
    if (!attempt)
      throw new AppError({
        code: "EXECUTION_ATTEMPT_NOT_FOUND",
        message: "ExecutionAttempt was not found.",
        statusCode: 404,
      });

    const runRow = await db.execute(
      sql`SELECT * FROM runs WHERE id = ${command.runId} FOR UPDATE`,
    );
    const run = mapRunRow(runRow.rows[0] as RunRow | undefined);
    if (!run)
      throw new AppError({
        code: "RUN_NOT_FOUND",
        message: "Run was not found.",
        statusCode: 404,
      });

    if (isRunTerminal(run.status)) {
      const isSameCompletion =
        attempt.status === "SUCCEEDED" &&
        attempt.id === command.attemptId &&
        run.status === command.outcome;
      if (isSameCompletion) return { run, attempt, replayed: true };
      throw new AppError({
        code: "RUN_ALREADY_TERMINAL",
        message: "Run is already terminal with a different outcome or attempt.",
        statusCode: 409,
        details: { currentStatus: run.status },
      });
    }

    if (attempt.id !== command.attemptId || !isAttemptActive(attempt, now))
      throw new AppError({
        code: "RUN_ATTEMPT_NOT_ACTIVE",
        message: "ExecutionAttempt is not the Run's current active attempt.",
        statusCode: 409,
      });

    const succeededAttempt = succeedAttempt(attempt, now);
    await this.updateAttempt(succeededAttempt);

    const terminatedRun = terminateRun(run, command.outcome, now);
    await this.updateRun(terminatedRun);
    await this.recordRunHistory(terminatedRun, attempt.workerIdentity);

    await this.outbox.enqueue({
      type: command.outcome === "COMPLETED" ? "RUN_COMPLETED" : "RUN_PARTIAL",
      version: 1,
      aggregate: { type: "RUN", id: terminatedRun.id },
      payload: {
        runId: terminatedRun.id,
        attemptId: succeededAttempt.id,
        revision: terminatedRun.revision,
      },
      occurredAt: terminatedRun.updatedAt,
    });

    return { run: terminatedRun, attempt: succeededAttempt, replayed: false };
  }

  async fail(command: FailAttemptCommand, now: Date): Promise<FailAttemptResult> {
    this.requireTransaction();
    const db = this.database.connection();
    const attemptRow = await db.execute(sql`
      SELECT * FROM execution_attempts
      WHERE id = ${command.attemptId} AND run_id = ${command.runId}
      FOR UPDATE
    `);
    const attempt = mapAttemptRow(attemptRow.rows[0] as AttemptRow | undefined);
    if (!attempt)
      throw new AppError({
        code: "EXECUTION_ATTEMPT_NOT_FOUND",
        message: "ExecutionAttempt was not found.",
        statusCode: 404,
      });

    const runRow = await db.execute(
      sql`SELECT * FROM runs WHERE id = ${command.runId} FOR UPDATE`,
    );
    const run = mapRunRow(runRow.rows[0] as RunRow | undefined);
    if (!run)
      throw new AppError({
        code: "RUN_NOT_FOUND",
        message: "Run was not found.",
        statusCode: 404,
      });

    if (isRunTerminal(run.status))
      throw new AppError({
        code: "RUN_ALREADY_TERMINAL",
        message: "Run is already terminal.",
        statusCode: 409,
        details: { currentStatus: run.status },
      });

    if (attempt.id !== command.attemptId || !isAttemptActive(attempt, now))
      throw new AppError({
        code: "RUN_ATTEMPT_NOT_ACTIVE",
        message: "ExecutionAttempt is not the Run's current active attempt.",
        statusCode: 409,
      });

    const failedAttempt = failAttempt(attempt, command.errorCode, command.retryable, now);
    await this.updateAttempt(failedAttempt);

    const updatedRun = command.retryable
      ? requeueRun(run, now)
      : terminateRun(run, "FAILED", now);
    await this.updateRun(updatedRun);
    await this.recordRunHistory(updatedRun, attempt.workerIdentity);

    await this.outbox.enqueue({
      type: "RUN_ATTEMPT_FAILED",
      version: 1,
      aggregate: { type: "EXECUTION_ATTEMPT", id: failedAttempt.id },
      payload: {
        runId: updatedRun.id,
        attemptId: failedAttempt.id,
        errorCode: failedAttempt.errorCode,
        retryable: failedAttempt.retryable,
        revision: updatedRun.revision,
      },
      occurredAt: updatedRun.updatedAt,
    });

    return { run: updatedRun, attempt: failedAttempt };
  }

  private async updateAttempt(attempt: ExecutionAttempt): Promise<void> {
    await this.database.connection().execute(sql`
      UPDATE execution_attempts
      SET status = ${attempt.status},
          lease_owner = ${attempt.leaseOwner},
          leased_until = ${attempt.leasedUntil},
          error_code = ${attempt.errorCode},
          retryable = ${attempt.retryable},
          last_progress = ${attempt.lastProgress ? JSON.stringify(attempt.lastProgress) : null}::jsonb,
          heartbeat_at = ${attempt.heartbeatAt},
          completed_at = ${attempt.completedAt},
          revision = ${attempt.revision},
          updated_at = ${attempt.updatedAt}
      WHERE id = ${attempt.id}
    `);
  }

  private async updateRun(run: Run): Promise<void> {
    await this.database.connection().execute(sql`
      UPDATE runs
      SET status = ${run.status},
          started_at = ${run.startedAt},
          completed_at = ${run.completedAt},
          revision = ${run.revision},
          updated_at = ${run.updatedAt}
      WHERE id = ${run.id}
    `);
  }

  private async recordRunHistory(run: Run, actor: string): Promise<void> {
    await this.database.connection().execute(sql`
      INSERT INTO run_revisions (run_id, revision, status, actor_user_id, occurred_at)
      VALUES (${run.id}, ${run.revision}, ${run.status}, ${actor}, ${run.updatedAt})
    `);
  }

  private requireTransaction(): void {
    if (!currentTransaction())
      throw new Error("ExecutionAttempt writes require a transaction.");
  }
}

type AttemptRow = {
  id: string;
  run_id: string;
  workspace_id: string;
  case_id: string;
  attempt_number: number;
  worker_identity: string;
  lease_owner: string;
  lease_duration_seconds: number;
  leased_until: Date | string;
  status: AttemptStatus;
  error_code: string | null;
  retryable: boolean | null;
  last_progress: AttemptProgress | null;
  started_at: Date | string;
  heartbeat_at: Date | string;
  completed_at: Date | string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapAttemptRow(row: AttemptRow | undefined): ExecutionAttempt | undefined {
  if (!row) return undefined;
  return Object.freeze({
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    caseId: row.case_id,
    attemptNumber: row.attempt_number,
    workerIdentity: row.worker_identity,
    leaseOwner: row.lease_owner,
    leaseDurationSeconds: row.lease_duration_seconds,
    leasedUntil: new Date(row.leased_until),
    status: row.status,
    errorCode: row.error_code,
    retryable: row.retryable,
    lastProgress: row.last_progress ? Object.freeze({ ...row.last_progress }) : null,
    startedAt: new Date(row.started_at),
    heartbeatAt: new Date(row.heartbeat_at),
    completedAt: row.completed_at === null ? null : new Date(row.completed_at),
    revision: row.revision,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
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

function mapRunRow(row: RunRow | undefined): Run | undefined {
  if (!row) return undefined;
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

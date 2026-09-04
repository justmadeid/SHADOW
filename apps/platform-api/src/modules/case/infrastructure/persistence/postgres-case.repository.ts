import { and, eq, inArray, sql } from "drizzle-orm";

import { DatabaseContext } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import type {
  CaseRepository,
  CreateCaseCommand,
  CreateCaseResult,
  TransitionCaseCommand,
  UpdateCaseCommand,
} from "../../domain/case-repository.js";
import type { Case } from "../../domain/case.js";
import { caseIdempotency, cases } from "./case.schema.js";

type CaseRow = {
  id: string;
  code: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: Case["status"];
  classification: Case["classification"];
  revision: number;
  created_at: string | Date;
  updated_at: string | Date;
  closed_at: string | Date | null;
  archived_at: string | Date | null;
};

export class PostgresCaseRepository implements CaseRepository {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}

  async create(command: CreateCaseCommand): Promise<CreateCaseResult> {
    const connection = this.database.connection();
    const lockKey = `case-create:${command.actorUserId}:${command.idempotencyKey}`;
    await connection.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );

    const replay = await connection.execute(sql`
      SELECT request_hash, case_id
      FROM case_idempotency
      WHERE user_id = ${command.actorUserId}
        AND idempotency_key = ${command.idempotencyKey}
    `);
    const replayRow = replay.rows[0] as
      { request_hash: string; case_id: string } | undefined;

    if (replayRow) {
      if (replayRow.request_hash !== command.requestHash) {
        throw new AppError({
          code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency-Key was already used with a different request.",
          statusCode: 409,
        });
      }

      const existing = await this.findById(replayRow.case_id);
      if (!existing) {
        throw new Error("Case idempotency record references missing data.");
      }
      return { case: existing, replayed: true };
    }

    const now = new Date();
    const caseId = newUuid();
    const code = createCaseCode(caseId, now);

    try {
      await connection.insert(cases).values({
        id: caseId,
        code,
        workspaceId: command.workspaceId,
        title: command.title,
        description: command.description ?? null,
        status: "DRAFT",
        classification: command.classification,
        revision: 1,
        createdByUserId: command.actorUserId,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        archivedAt: null,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          code: "CASE_CODE_CONFLICT",
          message: "The generated Case code conflicts with an existing Case.",
          statusCode: 409,
        });
      }
      throw error;
    }

    await connection.insert(caseIdempotency).values({
      userId: command.actorUserId,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      caseId,
      createdAt: now,
    });

    await this.outbox.enqueue({
      type: "CASE_CREATED",
      version: 1,
      aggregate: { type: "CASE", id: caseId },
      payload: { caseId, workspaceId: command.workspaceId, revision: 1 },
      occurredAt: now,
    });

    return {
      case: {
        id: caseId,
        code,
        workspaceId: command.workspaceId,
        title: command.title,
        description: command.description ?? null,
        status: "DRAFT",
        classification: command.classification,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        archivedAt: null,
      },
      replayed: false,
    };
  }

  async listByWorkspace(
    workspaceId: string,
    limit: number,
    authorizedCaseIds: string[],
  ): Promise<Case[]> {
    if (authorizedCaseIds.length === 0) return [];
    const result = await this.database.connection().execute(sql`
      SELECT id, code, workspace_id, title, description, status, classification,
             revision, created_at, updated_at, closed_at, archived_at
      FROM cases
      WHERE workspace_id = ${workspaceId}
        AND ${inArray(cases.id, authorizedCaseIds)}
      ORDER BY id DESC
      LIMIT ${Math.max(1, Math.min(100, Math.floor(limit)))}
    `);
    return (result.rows as CaseRow[]).map(mapCase);
  }

  async findById(caseId: string): Promise<Case | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT id, code, workspace_id, title, description, status, classification,
             revision, created_at, updated_at, closed_at, archived_at
      FROM cases
      WHERE id = ${caseId}
      LIMIT 1
    `);
    const row = result.rows[0] as CaseRow | undefined;
    return row ? mapCase(row) : undefined;
  }

  async update(command: UpdateCaseCommand): Promise<Case> {
    const now = new Date();
    const changedFields = Object.keys(command.changes).sort();
    const result = await this.database
      .connection()
      .update(cases)
      .set({
        ...(command.changes.title === undefined ? {} : { title: command.changes.title }),
        ...(command.changes.description === undefined
          ? {}
          : { description: command.changes.description }),
        ...(command.changes.classification === undefined
          ? {}
          : { classification: command.changes.classification }),
        revision: sql`${cases.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(eq(cases.id, command.caseId), eq(cases.revision, command.expectedRevision)),
      )
      .returning();

    const row = result[0];
    if (!row) {
      return this.revisionMismatch(command.caseId, command.expectedRevision);
    }

    await this.outbox.enqueue({
      type: "CASE_UPDATED",
      version: 1,
      aggregate: { type: "CASE", id: command.caseId },
      payload: {
        caseId: command.caseId,
        workspaceId: row.workspaceId,
        revision: row.revision,
        changedFields,
      },
      occurredAt: now,
    });

    return mapDrizzleCase(row);
  }

  async transition(command: TransitionCaseCommand): Promise<Case> {
    const now = new Date();
    const result = await this.database
      .connection()
      .update(cases)
      .set({
        status: command.toStatus,
        revision: sql`${cases.revision} + 1`,
        updatedAt: now,
        ...(command.toStatus === "CLOSED" ? { closedAt: now } : {}),
        ...(command.toStatus === "ACTIVE" ? { closedAt: null } : {}),
        ...(command.toStatus === "ARCHIVED" ? { archivedAt: now } : {}),
      })
      .where(
        and(
          eq(cases.id, command.caseId),
          eq(cases.revision, command.expectedRevision),
          eq(cases.status, command.fromStatus),
        ),
      )
      .returning();

    const row = result[0];
    if (!row) {
      return this.revisionMismatch(command.caseId, command.expectedRevision);
    }

    await this.outbox.enqueue({
      type: "CASE_STATUS_CHANGED",
      version: 1,
      aggregate: { type: "CASE", id: command.caseId },
      payload: {
        caseId: command.caseId,
        workspaceId: row.workspaceId,
        revision: row.revision,
        fromStatus: command.fromStatus,
        toStatus: command.toStatus,
      },
      occurredAt: now,
    });

    return mapDrizzleCase(row);
  }

  private async revisionMismatch(
    caseId: string,
    expectedRevision: number,
  ): Promise<never> {
    const current = await this.findById(caseId);
    if (!current) {
      throw new AppError({
        code: "CASE_NOT_FOUND",
        message: "Case was not found.",
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

function createCaseCode(caseId: string, now: Date): string {
  const opaqueSuffix = caseId.replaceAll("-", "").slice(-10).toUpperCase();
  return `CASE-${now.getUTCFullYear()}-${opaqueSuffix}`;
}

function mapCase(row: CaseRow): Case {
  return {
    id: row.id,
    code: row.code,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    status: row.status,
    classification: row.classification,
    revision: row.revision,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    closedAt: row.closed_at === null ? null : new Date(row.closed_at),
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
  };
}

function mapDrizzleCase(row: typeof cases.$inferSelect): Case {
  return {
    id: row.id,
    code: row.code,
    workspaceId: row.workspaceId,
    title: row.title,
    description: row.description,
    status: row.status as Case["status"],
    classification: row.classification as Case["classification"],
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt,
    archivedAt: row.archivedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === "23505",
  );
}

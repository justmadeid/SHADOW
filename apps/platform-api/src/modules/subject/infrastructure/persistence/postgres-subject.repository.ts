import { sql } from "drizzle-orm";
import { DatabaseContext, currentTransaction } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import {
  archiveSubject,
  createSubject,
  updateSubjectRole,
  type InvestigationSubject,
} from "../../domain/investigation-subject.js";
import type {
  SubjectRepository,
  UpdateSubjectInput,
} from "../../domain/subject-repository.js";

export class PostgresSubjectRepository implements SubjectRepository {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}

  async create(
    command: Parameters<SubjectRepository["create"]>[0],
  ): Promise<InvestigationSubject> {
    this.requireTransaction();
    const db = this.database.connection();
    const lock = `subject-create:${command.actorUserId}:${command.idempotencyKey}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
    const replay =
      await db.execute(sql`SELECT request_hash, subject_id FROM subject_idempotency
      WHERE user_id = ${command.actorUserId} AND idempotency_key = ${command.idempotencyKey}`);
    const row = replay.rows[0] as
      { request_hash: string; subject_id: string } | undefined;
    if (row) {
      if (row.request_hash !== command.requestHash)
        throw new AppError({
          code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency-Key was already used with a different request.",
          statusCode: 409,
        });
      const existing = await this.find(row.subject_id);
      if (
        !existing ||
        existing.workspaceId !== command.workspaceId ||
        existing.caseId !== command.caseId
      )
        throw new Error("Invalid Subject replay record.");
      return existing;
    }
    const value = createSubject({ ...command, id: newUuid() }, new Date());
    await db.execute(sql`INSERT INTO investigation_subjects
      (id, workspace_id, case_id, investigation_id, subject_type, role, status, revision, created_by_user_id, created_at, updated_at)
      VALUES (${value.id}, ${value.workspaceId}, ${value.caseId}, ${value.investigationId}, ${value.subjectType}, ${value.role}, ${value.status}, 1, ${command.actorUserId}, ${value.createdAt}, ${value.updatedAt})`);
    await db.execute(sql`INSERT INTO subject_idempotency (user_id, idempotency_key, request_hash, subject_id)
      VALUES (${command.actorUserId}, ${command.idempotencyKey}, ${command.requestHash}, ${value.id})`);
    await this.record(value, command.actorUserId, "SUBJECT_CREATED");
    return value;
  }

  async find(id: string): Promise<InvestigationSubject | undefined> {
    const result = await this.database
      .connection()
      .execute(sql`SELECT * FROM investigation_subjects WHERE id = ${id}`);
    return result.rows[0] ? mapRow(result.rows[0] as SubjectRow) : undefined;
  }

  async list(
    workspaceId: string,
    caseId: string,
    limit: number,
    before?: string,
  ): Promise<InvestigationSubject[]> {
    const bound = Math.max(1, Math.min(101, Math.floor(limit)));
    const result = await this.database.connection()
      .execute(sql`SELECT * FROM investigation_subjects
      WHERE workspace_id = ${workspaceId} AND case_id = ${caseId}
      ${before ? sql`AND id < ${before}::uuid` : sql``}
      ORDER BY id DESC LIMIT ${bound}`);
    return (result.rows as SubjectRow[]).map(mapRow);
  }

  async update(
    current: InvestigationSubject,
    input: UpdateSubjectInput,
    actorUserId: string,
  ): Promise<InvestigationSubject> {
    this.requireTransaction();
    // Role and archive are separate commands, each advances exactly one revision.
    const value =
      input.status === "ARCHIVED"
        ? archiveSubject(current, current.revision, new Date())
        : updateSubjectRole(current, input.role!, current.revision, new Date());
    const result = await this.database.connection()
      .execute(sql`UPDATE investigation_subjects
      SET role = ${value.role}, status = ${value.status}, revision = ${value.revision}, updated_at = ${value.updatedAt}
      WHERE id = ${current.id} AND workspace_id = ${current.workspaceId} AND case_id = ${current.caseId}
        AND revision = ${current.revision} RETURNING id`);
    if (!result.rows.length)
      throw new AppError({
        code: "CONFLICT_REVISION_MISMATCH",
        message: "The resource has changed since it was read.",
        statusCode: 412,
      });
    await this.record(
      value,
      actorUserId,
      input.status ? "SUBJECT_ARCHIVED" : "SUBJECT_UPDATED",
    );
    return value;
  }

  private async record(value: InvestigationSubject, actorUserId: string, type: string) {
    await this.database.connection()
      .execute(sql`INSERT INTO subject_revisions (subject_id, revision, role, status, actor_user_id, occurred_at)
      VALUES (${value.id}, ${value.revision}, ${value.role}, ${value.status}, ${actorUserId}, ${value.updatedAt})`);
    await this.outbox.enqueue({
      type,
      version: 1,
      aggregate: { type: "SUBJECT", id: value.id },
      payload: {
        subjectId: value.id,
        workspaceId: value.workspaceId,
        caseId: value.caseId,
        revision: value.revision,
      },
      occurredAt: new Date(value.updatedAt),
    });
  }
  private requireTransaction() {
    if (!currentTransaction()) throw new Error("Subject writes require a transaction.");
  }
}

type SubjectRow = {
  id: string;
  workspace_id: string;
  case_id: string;
  investigation_id: string | null;
  subject_type: InvestigationSubject["subjectType"];
  role: InvestigationSubject["role"];
  status: InvestigationSubject["status"];
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};
function mapRow(row: SubjectRow): InvestigationSubject {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspace_id,
    caseId: row.case_id,
    investigationId: row.investigation_id,
    subjectType: row.subject_type,
    role: row.role,
    status: row.status,
    entityRef: null,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

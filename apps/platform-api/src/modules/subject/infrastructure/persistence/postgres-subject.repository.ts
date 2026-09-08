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
import {
  buildSubjectSeed,
  type ProvenanceRef,
  type SubjectSeed,
  type SubjectSeedField,
  type SubjectSeedFieldInput,
} from "../../domain/subject-seed.js";
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
      const existingSeed = existing.seed ? await this.findSeed(existing.id) : undefined;
      if (!sameSeed(command.seed?.fields, existingSeed?.fields))
        throw new AppError({
          code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency-Key was already used with a different request.",
          statusCode: 409,
        });
      return existing;
    }
    const subjectId = newUuid();
    const seed = command.seed
      ? buildSubjectSeed(
          {
            id: newUuid(),
            subjectId,
            workspaceId: command.workspaceId,
            caseId: command.caseId,
            subjectType: command.subjectType,
            fields: command.seed.fields.map((field) => ({ ...field, id: newUuid() })),
          },
          new Date(),
        )
      : undefined;
    const value = createSubject(
      {
        ...command,
        id: subjectId,
        seed: seed ? { id: seed.id, fieldCount: seed.fields.length } : null,
      },
      new Date(),
    );
    await db.execute(sql`INSERT INTO investigation_subjects
      (id, workspace_id, case_id, investigation_id, subject_type, role, status, revision, created_by_user_id, created_at, updated_at)
      VALUES (${value.id}, ${value.workspaceId}, ${value.caseId}, ${value.investigationId}, ${value.subjectType}, ${value.role}, ${value.status}, 1, ${command.actorUserId}, ${value.createdAt}, ${value.updatedAt})`);
    await db.execute(sql`INSERT INTO subject_idempotency (user_id, idempotency_key, request_hash, subject_id)
      VALUES (${command.actorUserId}, ${command.idempotencyKey}, ${command.requestHash}, ${value.id})`);
    if (seed) {
      await db.execute(sql`INSERT INTO subject_seeds (id, subject_id, workspace_id, case_id, created_at)
        VALUES (${seed.id}, ${seed.subjectId}, ${seed.workspaceId}, ${seed.caseId}, ${seed.createdAt})`);
      for (const field of seed.fields)
        await db.execute(sql`INSERT INTO subject_seed_fields
          (id, seed_id, ordinal, field_name, value_text, origin, classification, evidence_id, source_record_id)
          VALUES (${field.id}, ${seed.id}, ${field.ordinal}, ${field.name}, ${field.value}, ${field.origin}, ${field.classification}, ${field.evidenceRef?.id ?? null}, ${field.sourceRecordRef?.id ?? null})`);
    }
    await this.record(value, command.actorUserId, "SUBJECT_CREATED");
    return value;
  }

  async find(id: string): Promise<InvestigationSubject | undefined> {
    const result = await this.database.connection().execute(sql`SELECT s.*,
        (SELECT ss.id FROM subject_seeds ss WHERE ss.subject_id = s.id) AS seed_id,
        (SELECT count(*)::int FROM subject_seed_fields sf JOIN subject_seeds ss ON ss.id = sf.seed_id WHERE ss.subject_id = s.id) AS seed_field_count
        FROM investigation_subjects s WHERE s.id = ${id}`);
    return result.rows[0] ? mapRow(result.rows[0] as SubjectRow) : undefined;
  }

  async findSeed(subjectId: string): Promise<SubjectSeed | undefined> {
    const seedResult = await this.database.connection().execute(sql`
      SELECT ss.id, ss.subject_id, ss.workspace_id, ss.case_id, ss.created_at,
        s.subject_type
      FROM subject_seeds ss
      JOIN investigation_subjects s ON s.id = ss.subject_id
      WHERE ss.subject_id = ${subjectId}`);
    const seed = seedResult.rows[0] as SeedRow | undefined;
    if (!seed) return undefined;
    const fieldResult = await this.database.connection().execute(sql`
      SELECT id, ordinal, field_name, value_text, origin, classification, evidence_id, source_record_id
      FROM subject_seed_fields WHERE seed_id = ${seed.id} ORDER BY ordinal`);
    return buildSubjectSeed(
      {
        id: seed.id,
        subjectId: seed.subject_id,
        workspaceId: seed.workspace_id,
        caseId: seed.case_id,
        subjectType: seed.subject_type,
        fields: (fieldResult.rows as SeedFieldRow[]).map((field) => ({
          id: field.id,
          name: field.field_name,
          value: field.value_text,
          origin: field.origin,
          classification: field.classification,
          evidenceRef: ref(field.evidence_id, "EVIDENCE", seed),
          sourceRecordRef: ref(field.source_record_id, "SOURCE_RECORD", seed),
        })),
      },
      new Date(seed.created_at),
    );
  }

  async list(
    workspaceId: string,
    caseId: string,
    limit: number,
    before?: string,
  ): Promise<InvestigationSubject[]> {
    const bound = Math.max(1, Math.min(101, Math.floor(limit)));
    const result = await this.database.connection().execute(sql`SELECT s.*,
        (SELECT ss.id FROM subject_seeds ss WHERE ss.subject_id = s.id) AS seed_id,
        (SELECT count(*)::int FROM subject_seed_fields sf JOIN subject_seeds ss ON ss.id = sf.seed_id WHERE ss.subject_id = s.id) AS seed_field_count
      FROM investigation_subjects s
      WHERE s.workspace_id = ${workspaceId} AND s.case_id = ${caseId}
      ${before ? sql`AND s.id < ${before}::uuid` : sql``}
      ORDER BY s.id DESC LIMIT ${bound}`);
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

  async saveResolutionTransition(
    current: InvestigationSubject,
    next: InvestigationSubject,
    actorUserId: string,
    eventType:
      "SUBJECT_RESOLUTION_STARTED" | "SUBJECT_RESOLVED" | "SUBJECT_RESOLUTION_FAILED",
  ): Promise<InvestigationSubject> {
    this.requireTransaction();
    if (
      next.id !== current.id ||
      next.workspaceId !== current.workspaceId ||
      next.caseId !== current.caseId ||
      next.revision !== current.revision + 1
    )
      throw new Error("Invalid Subject resolution transition.");
    const result = await this.database.connection()
      .execute(sql`UPDATE investigation_subjects
      SET status = ${next.status}, entity_id = ${next.entityRef?.id ?? null},
        revision = ${next.revision}, updated_at = ${next.updatedAt}
      WHERE id = ${current.id} AND workspace_id = ${current.workspaceId}
        AND case_id = ${current.caseId} AND revision = ${current.revision}
      RETURNING id`);
    if (!result.rows.length)
      throw new AppError({
        code: "CONFLICT_REVISION_MISMATCH",
        message: "The resource has changed since it was read.",
        statusCode: 412,
      });
    await this.record(next, actorUserId, eventType);
    return next;
  }

  private async record(value: InvestigationSubject, actorUserId: string, type: string) {
    await this.database.connection().execute(sql`INSERT INTO subject_revisions
      (subject_id, revision, role, status, entity_id, actor_user_id, occurred_at)
      VALUES (${value.id}, ${value.revision}, ${value.role}, ${value.status},
        ${value.entityRef?.id ?? null}, ${actorUserId}, ${value.updatedAt})`);
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
  entity_id: string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  seed_id: string | null;
  seed_field_count: number;
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
    entityRef: row.entity_id
      ? { type: "ENTITY" as const, id: row.entity_id, workspaceId: row.workspace_id }
      : null,
    seed: row.seed_id
      ? { id: row.seed_id, fieldCount: Number(row.seed_field_count) }
      : null,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

type SeedRow = {
  id: string;
  subject_id: string;
  workspace_id: string;
  case_id: string;
  created_at: Date | string;
  subject_type: InvestigationSubject["subjectType"];
};
type SeedFieldRow = {
  id: string;
  ordinal: number;
  field_name: SubjectSeedFieldInput["name"];
  value_text: string;
  origin: SubjectSeedFieldInput["origin"];
  classification: SubjectSeedFieldInput["classification"];
  evidence_id: string | null;
  source_record_id: string | null;
};
function ref(
  id: string | null,
  type: "EVIDENCE" | "SOURCE_RECORD",
  seed: SeedRow,
): ProvenanceRef | null {
  return id ? { type, id, workspaceId: seed.workspace_id, caseId: seed.case_id } : null;
}
function sameSeed(
  requested: readonly SubjectSeedFieldInput[] | undefined,
  persisted: readonly SubjectSeedField[] | undefined,
): boolean {
  if (!requested || !persisted) return requested === undefined && persisted === undefined;
  if (requested.length !== persisted.length) return false;
  return requested.every((field, index) => {
    const current = persisted[index];
    return (
      current?.name === field.name &&
      current.value === field.value &&
      current.origin === field.origin &&
      current.classification === field.classification &&
      (current.evidenceRef?.id ?? null) === (field.evidenceRef?.id ?? null) &&
      (current.sourceRecordRef?.id ?? null) === (field.sourceRecordRef?.id ?? null)
    );
  });
}

import { sql } from "drizzle-orm";
import { DatabaseContext, currentTransaction } from "@intelligence/database";
import type { ResourceRef } from "@intelligence/contracts";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { parseIdempotencyKey } from "../../../../platform/http/idempotency.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import {
  createCandidate,
  type Candidate,
  type CandidateSourceOrigin,
} from "../../domain/candidate.js";
import type { ResolutionRepository } from "../../domain/resolution-repository.js";
import {
  createResolutionSession,
  registerCandidate,
  type ResolutionSession,
} from "../../domain/resolution-session.js";

export class PostgresResolutionRepository implements ResolutionRepository {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}

  async createSession(
    command: Parameters<ResolutionRepository["createSession"]>[0],
  ): Promise<ResolutionSession> {
    this.requireTransaction();
    parseIdempotencyKey(command.idempotencyKey, { required: true });
    if (
      !command.actorUserId.trim() ||
      command.actorUserId.length > 255 ||
      !/^[a-f0-9]{64}$/.test(command.requestHash)
    )
      this.invalid();
    const db = this.database.connection();
    const lock = `resolution-session:${command.actorUserId}:${command.idempotencyKey}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
    const replay = await db.execute(sql`SELECT request_hash, resolution_session_id
      FROM resolution_session_idempotency
      WHERE user_id = ${command.actorUserId} AND idempotency_key = ${command.idempotencyKey}`);
    const row = replay.rows[0] as
      { request_hash: string; resolution_session_id: string } | undefined;
    if (row) {
      if (row.request_hash !== command.requestHash) this.idempotencyConflict();
      const existing = await this.findSession(row.resolution_session_id);
      if (
        !existing ||
        existing.subjectId !== command.subjectId ||
        existing.workspaceId !== command.workspaceId ||
        existing.caseId !== command.caseId
      )
        throw new Error("Invalid ResolutionSession replay record.");
      return existing;
    }
    const value = createResolutionSession(
      {
        id: newUuid(),
        subjectId: command.subjectId,
        workspaceId: command.workspaceId,
        caseId: command.caseId,
      },
      new Date(),
    );
    try {
      await db.execute(sql`INSERT INTO resolution_sessions
        (id, subject_id, workspace_id, case_id, status, candidates_count,
         selected_candidate_id, resolution_decision_id, revision, created_by_user_id,
         created_at, updated_at)
        VALUES (${value.id}, ${value.subjectId}, ${value.workspaceId}, ${value.caseId},
          ${value.status}, 0, NULL, NULL, 1, ${command.actorUserId},
          ${value.createdAt}, ${value.updatedAt})`);
    } catch (error) {
      if (isConstraint(error, "resolution_sessions_subject_active_uq"))
        throw new AppError({
          code: "RESOLUTION_SESSION_ACTIVE",
          message: "The Subject already has an active Resolution session.",
          statusCode: 409,
        });
      throw error;
    }
    await db.execute(sql`INSERT INTO resolution_session_idempotency
      (user_id, idempotency_key, request_hash, resolution_session_id, created_at)
      VALUES (${command.actorUserId}, ${command.idempotencyKey}, ${command.requestHash},
        ${value.id}, ${value.createdAt})`);
    await this.recordSession(value, command.actorUserId, "RESOLUTION_SESSION_CREATED");
    return value;
  }

  async addCandidate(
    command: Parameters<ResolutionRepository["addCandidate"]>[0],
  ): Promise<{ session: ResolutionSession; candidate: Candidate }> {
    this.requireTransaction();
    parseIdempotencyKey(command.idempotencyKey, { required: true });
    if (
      !["USER", "SERVICE"].includes(command.producerType) ||
      !command.producerId.trim() ||
      command.producerId.length > 255
    )
      this.invalid();
    const db = this.database.connection();
    const lock = `candidate:${command.producerType}:${command.producerId}:${command.idempotencyKey}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
    const replay = await db.execute(sql`SELECT candidate_id FROM candidate_idempotency
      WHERE producer_type = ${command.producerType} AND producer_id = ${command.producerId}
        AND idempotency_key = ${command.idempotencyKey}`);
    const replayId = (replay.rows[0] as { candidate_id: string } | undefined)
      ?.candidate_id;
    if (replayId) {
      const existing = await this.findCandidate(replayId);
      const session = await this.findSession(command.resolutionSessionId);
      if (!existing || !session || !sameCandidate(existing, command))
        this.idempotencyConflict();
      return { session, candidate: existing };
    }

    const sessionResult = await db.execute(sql`SELECT * FROM resolution_sessions
      WHERE id = ${command.resolutionSessionId} FOR UPDATE`);
    const current = sessionResult.rows[0]
      ? mapSession(sessionResult.rows[0] as ResolutionSessionRow)
      : undefined;
    if (
      !current ||
      current.subjectId !== command.subjectId ||
      current.workspaceId !== command.workspaceId ||
      current.caseId !== command.caseId
    )
      throw new AppError({
        code: "RESOLUTION_NOT_FOUND",
        message: "Resolution session was not found.",
        statusCode: 404,
      });
    const candidate = createCandidate({ ...command, id: newUuid() }, new Date());
    const session = registerCandidate(
      current,
      candidate,
      current.revision,
      new Date(candidate.createdAt),
    );
    await db.execute(sql`INSERT INTO candidates
      (id, resolution_session_id, subject_id, workspace_id, case_id, candidate_type,
       status, display_label, classification, source_origin, source_resource_type,
       source_resource_id, revision, created_at, updated_at)
      VALUES (${candidate.id}, ${candidate.resolutionSessionId}, ${candidate.subjectId},
        ${candidate.workspaceId}, ${candidate.caseId}, ${candidate.type},
        ${candidate.status}, ${candidate.displayLabel}, ${candidate.classification},
        ${candidate.source.origin}, ${candidate.source.resource?.type ?? null},
        ${candidate.source.resource?.id ?? null}, 1, ${candidate.createdAt},
        ${candidate.updatedAt})`);
    for (const [ordinal, reference] of candidate.evidenceRefs.entries())
      await db.execute(sql`INSERT INTO candidate_evidence_refs
        (candidate_id, ordinal, evidence_id, workspace_id, case_id)
        VALUES (${candidate.id}, ${ordinal}, ${reference.id}, ${reference.workspaceId},
          ${reference.caseId!})`);
    await db.execute(sql`INSERT INTO candidate_idempotency
      (producer_type, producer_id, idempotency_key, candidate_id, created_at)
      VALUES (${command.producerType}, ${command.producerId}, ${command.idempotencyKey},
        ${candidate.id}, ${candidate.createdAt})`);
    const updated = await db.execute(sql`UPDATE resolution_sessions
      SET status = ${session.status}, candidates_count = ${session.candidatesCount},
        revision = ${session.revision}, updated_at = ${session.updatedAt}
      WHERE id = ${current.id} AND revision = ${current.revision} RETURNING id`);
    if (!updated.rows.length)
      throw new AppError({
        code: "CONFLICT_REVISION_MISMATCH",
        message: "The resource has changed since it was read.",
        statusCode: 412,
      });
    await this.recordCandidate(candidate, command.producerType, command.producerId);
    await this.recordSession(session, command.producerId, "RESOLUTION_CANDIDATE_ADDED");
    return { session, candidate };
  }

  async findSession(id: string): Promise<ResolutionSession | undefined> {
    const result = await this.database
      .connection()
      .execute(sql`SELECT * FROM resolution_sessions WHERE id = ${id}`);
    return result.rows[0]
      ? mapSession(result.rows[0] as ResolutionSessionRow)
      : undefined;
  }

  async findCandidate(id: string): Promise<Candidate | undefined> {
    const result = await this.database.connection().execute(sql`SELECT c.*,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', er.evidence_id, 'workspaceId', er.workspace_id, 'caseId', er.case_id
      ) ORDER BY er.ordinal) FILTER (WHERE er.candidate_id IS NOT NULL), '[]'::jsonb) AS evidence_refs
      FROM candidates c LEFT JOIN candidate_evidence_refs er ON er.candidate_id = c.id
      WHERE c.id = ${id} GROUP BY c.id`);
    return result.rows[0] ? mapCandidate(result.rows[0] as CandidateRow) : undefined;
  }

  async listCandidates(
    resolutionSessionId: string,
    limit: number,
    before?: string,
  ): Promise<Candidate[]> {
    const bound = Math.max(1, Math.min(101, Math.floor(limit)));
    const result = await this.database.connection().execute(sql`SELECT c.*,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', er.evidence_id, 'workspaceId', er.workspace_id, 'caseId', er.case_id
      ) ORDER BY er.ordinal) FILTER (WHERE er.candidate_id IS NOT NULL), '[]'::jsonb) AS evidence_refs
      FROM candidates c LEFT JOIN candidate_evidence_refs er ON er.candidate_id = c.id
      WHERE c.resolution_session_id = ${resolutionSessionId}
        ${before ? sql`AND c.id < ${before}::uuid` : sql``}
      GROUP BY c.id ORDER BY c.id DESC LIMIT ${bound}`);
    return (result.rows as CandidateRow[]).map(mapCandidate);
  }

  private async recordSession(
    value: ResolutionSession,
    actorId: string,
    eventType: string,
  ): Promise<void> {
    await this.database.connection().execute(sql`INSERT INTO resolution_session_revisions
      (resolution_session_id, revision, status, candidates_count, selected_candidate_id,
       resolution_decision_id, actor_id, occurred_at)
      VALUES (${value.id}, ${value.revision}, ${value.status}, ${value.candidatesCount},
        ${value.selectedCandidateId}, ${value.resolutionDecisionId}, ${actorId},
        ${value.updatedAt})`);
    await this.outbox.enqueue({
      type: eventType,
      version: 1,
      aggregate: { type: "RESOLUTION", id: value.id },
      payload: {
        resolutionSessionId: value.id,
        subjectId: value.subjectId,
        workspaceId: value.workspaceId,
        caseId: value.caseId,
        status: value.status,
        revision: value.revision,
      },
      occurredAt: new Date(value.updatedAt),
    });
  }

  private async recordCandidate(
    value: Candidate,
    actorType: "USER" | "SERVICE",
    actorId: string,
  ): Promise<void> {
    await this.database.connection().execute(sql`INSERT INTO candidate_revisions
      (candidate_id, revision, status, actor_type, actor_id, occurred_at)
      VALUES (${value.id}, ${value.revision}, ${value.status}, ${actorType}, ${actorId},
        ${value.updatedAt})`);
    await this.outbox.enqueue({
      type: "CANDIDATE_CREATED",
      version: 1,
      aggregate: { type: "CANDIDATE", id: value.id },
      payload: {
        candidateId: value.id,
        resolutionSessionId: value.resolutionSessionId,
        subjectId: value.subjectId,
        workspaceId: value.workspaceId,
        caseId: value.caseId,
        status: value.status,
        revision: value.revision,
      },
      occurredAt: new Date(value.updatedAt),
    });
  }

  private requireTransaction(): void {
    if (!currentTransaction())
      throw new Error("Resolution writes require a transaction.");
  }

  private idempotencyConflict(): never {
    throw new AppError({
      code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
      message: "Idempotency-Key was already used with a different request.",
      statusCode: 409,
    });
  }

  private invalid(): never {
    throw new AppError({
      code: "VALIDATION_RESOLUTION_INVALID",
      message: "Resolution input is invalid.",
      statusCode: 400,
    });
  }
}

type ResolutionSessionRow = {
  id: string;
  subject_id: string;
  workspace_id: string;
  case_id: string;
  status: ResolutionSession["status"];
  candidates_count: number;
  selected_candidate_id: string | null;
  resolution_decision_id: string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type EvidenceRow = { id: string; workspaceId: string; caseId: string };
type CandidateRow = {
  id: string;
  resolution_session_id: string;
  subject_id: string;
  workspace_id: string;
  case_id: string;
  candidate_type: Candidate["type"];
  status: Candidate["status"];
  display_label: string;
  classification: Candidate["classification"];
  source_origin: CandidateSourceOrigin;
  source_resource_type: ResourceRef["type"] | null;
  source_resource_id: string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  evidence_refs: EvidenceRow[];
};

function mapSession(row: ResolutionSessionRow): ResolutionSession {
  return Object.freeze({
    id: row.id,
    subjectId: row.subject_id,
    workspaceId: row.workspace_id,
    caseId: row.case_id,
    status: row.status,
    candidatesCount: Number(row.candidates_count),
    selectedCandidateId: row.selected_candidate_id,
    resolutionDecisionId: row.resolution_decision_id,
    revision: Number(row.revision),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function mapCandidate(row: CandidateRow): Candidate {
  const sourceResource =
    row.source_resource_type && row.source_resource_id
      ? {
          type: row.source_resource_type,
          id: row.source_resource_id,
          workspaceId: row.workspace_id,
          caseId: row.case_id,
        }
      : null;
  return Object.freeze({
    id: row.id,
    resolutionSessionId: row.resolution_session_id,
    subjectId: row.subject_id,
    workspaceId: row.workspace_id,
    caseId: row.case_id,
    type: row.candidate_type,
    status: row.status,
    displayLabel: row.display_label,
    classification: row.classification,
    source: Object.freeze({ origin: row.source_origin, resource: sourceResource }),
    evidenceRefs: Object.freeze(
      (row.evidence_refs ?? []).map((reference) =>
        Object.freeze({ type: "EVIDENCE" as const, ...reference }),
      ),
    ),
    revision: Number(row.revision),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function sameCandidate(
  current: Candidate,
  requested: Parameters<ResolutionRepository["addCandidate"]>[0],
): boolean {
  try {
    const normalized = createCandidate(
      { ...requested, id: current.id },
      new Date(current.createdAt),
    );
    return (
      normalized.resolutionSessionId === current.resolutionSessionId &&
      normalized.subjectId === current.subjectId &&
      normalized.workspaceId === current.workspaceId &&
      normalized.caseId === current.caseId &&
      normalized.type === current.type &&
      normalized.displayLabel === current.displayLabel &&
      normalized.classification === current.classification &&
      normalized.source.origin === current.source.origin &&
      sameRef(normalized.source.resource, current.source.resource) &&
      normalized.evidenceRefs.length === current.evidenceRefs.length &&
      normalized.evidenceRefs.every((reference, index) =>
        sameRef(reference, current.evidenceRefs[index] ?? null),
      )
    );
  } catch {
    return false;
  }
}

function sameRef(left: ResourceRef | null, right: ResourceRef | null): boolean {
  return (
    left === right ||
    Boolean(
      left &&
      right &&
      left.type === right.type &&
      left.id === right.id &&
      left.workspaceId === right.workspaceId &&
      left.caseId === right.caseId,
    )
  );
}

function isConstraint(error: unknown, constraint: string): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "constraint" in error &&
    error.constraint === constraint,
  );
}

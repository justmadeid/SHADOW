import { sql } from "drizzle-orm";
import { DatabaseContext, currentTransaction } from "@intelligence/database";
import type { ResourceRef } from "@intelligence/contracts";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { parseIdempotencyKey } from "../../../../platform/http/idempotency.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import {
  createCandidate,
  decideCandidate,
  type Candidate,
  type CandidateSourceOrigin,
  type ResolutionDecision,
} from "../../domain/candidate.js";
import {
  createEntityMatch,
  type CreateMatchSignalInput,
  type EntityMatch,
  type MatchSignalField,
  type MatchSignalKind,
  type MatchSignalResult,
  type MatchSignalStrength,
} from "../../domain/matching-signal.js";
import type { ResolutionRepository } from "../../domain/resolution-repository.js";
import {
  createResolutionSession,
  recordResolutionDecision,
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
  ): Promise<{ session: ResolutionSession; replayed: boolean }> {
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
      return { session: existing, replayed: true };
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
    return { session: value, replayed: false };
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

  async findLatestSessionForSubject(
    subjectId: string,
  ): Promise<ResolutionSession | undefined> {
    const result = await this.database
      .connection()
      .execute(
        sql`SELECT * FROM resolution_sessions WHERE subject_id = ${subjectId} ORDER BY id DESC LIMIT 1`,
      );
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

  async prepareCandidateDecision(
    command: Parameters<ResolutionRepository["prepareCandidateDecision"]>[0],
  ): ReturnType<ResolutionRepository["prepareCandidateDecision"]> {
    this.requireTransaction();
    parseIdempotencyKey(command.idempotencyKey, { required: true });
    if (
      !command.actorUserId.trim() ||
      command.actorUserId.length > 255 ||
      !/^[a-f0-9]{64}$/.test(command.requestHash)
    )
      this.invalid();
    const db = this.database.connection();
    const lock = `candidate-resolution:${command.actorUserId}:${command.idempotencyKey}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
    const replay = await db.execute(sql`SELECT request_hash, candidate_id, decision_id
      FROM candidate_resolution_idempotency
      WHERE user_id = ${command.actorUserId} AND idempotency_key = ${command.idempotencyKey}`);
    const replayRow = replay.rows[0] as
      { request_hash: string; candidate_id: string; decision_id: string } | undefined;
    if (replayRow) {
      if (
        replayRow.request_hash !== command.requestHash ||
        replayRow.candidate_id !== command.candidateId
      )
        this.idempotencyConflict();
      const candidate = await this.findCandidate(replayRow.candidate_id);
      const decision = await this.findDecision(replayRow.decision_id);
      const session = candidate
        ? await this.findSession(candidate.resolutionSessionId)
        : undefined;
      if (!candidate || !decision || !session)
        throw new Error("Invalid decision replay.");
      return { replayed: true, session, candidate, decision };
    }

    const scope = await db.execute(sql`SELECT resolution_session_id FROM candidates
      WHERE id = ${command.candidateId}`);
    const resolutionSessionId = (
      scope.rows[0] as { resolution_session_id: string } | undefined
    )?.resolution_session_id;
    if (!resolutionSessionId) this.candidateNotFound();
    const sessionResult = await db.execute(sql`SELECT * FROM resolution_sessions
      WHERE id = ${resolutionSessionId} FOR UPDATE`);
    const candidateLock = await db.execute(sql`SELECT id FROM candidates
      WHERE id = ${command.candidateId} FOR UPDATE`);
    const session = sessionResult.rows[0]
      ? mapSession(sessionResult.rows[0] as ResolutionSessionRow)
      : undefined;
    const candidate = candidateLock.rows.length
      ? await this.findCandidate(command.candidateId)
      : undefined;
    if (
      !session ||
      !candidate ||
      candidate.resolutionSessionId !== session.id ||
      candidate.subjectId !== session.subjectId ||
      candidate.workspaceId !== session.workspaceId ||
      candidate.caseId !== session.caseId
    )
      this.candidateNotFound();
    if (candidate.status !== "PENDING_REVIEW")
      throw new AppError({
        code: "CANDIDATE_ALREADY_DECIDED",
        message: "Candidate has already received a decision.",
        statusCode: 409,
      });
    if (session.status !== "NEEDS_REVIEW")
      throw new AppError({
        code: "RESOLUTION_INVALID_STATUS_TRANSITION",
        message: "Resolution status transition is not allowed.",
        statusCode: 409,
      });
    const pending = await db.execute(sql`SELECT count(*)::int AS count FROM candidates
      WHERE resolution_session_id = ${session.id} AND status = 'PENDING_REVIEW'
        AND id <> ${candidate.id}`);
    return {
      replayed: false,
      session,
      candidate,
      remainingPendingCandidates: Number((pending.rows[0] as { count: number }).count),
    };
  }

  async commitCandidateDecision(
    command: Parameters<ResolutionRepository["commitCandidateDecision"]>[0],
  ): ReturnType<ResolutionRepository["commitCandidateDecision"]> {
    this.requireTransaction();
    const now = new Date();
    const result = decideCandidate(
      command.candidate,
      {
        id: newUuid(),
        decision: command.decision,
        ...(command.targetEntityId === undefined
          ? {}
          : { targetEntityId: command.targetEntityId }),
        reasonCode: command.reasonCode,
        decidedByUserId: command.actorUserId,
      },
      command.candidate.revision,
      now,
    );
    const session = recordResolutionDecision(
      command.session,
      result.candidate,
      result.decision,
      command.remainingPendingCandidates,
      command.session.revision,
      now,
    );
    const db = this.database.connection();
    await db.execute(sql`INSERT INTO resolution_decisions
      (id, resolution_session_id, candidate_id, decision, target_entity_id,
       reason_code, decided_by_user_id, decided_at, workspace_id)
      VALUES (${result.decision.id}, ${result.decision.resolutionSessionId},
        ${result.decision.candidateId}, ${result.decision.decision},
        ${result.decision.targetEntityId}, ${result.decision.reasonCode},
        ${result.decision.decidedByUserId}, ${result.decision.decidedAt},
        ${command.candidate.workspaceId})`);
    const candidateUpdate = await db.execute(sql`UPDATE candidates
      SET status = ${result.candidate.status}, revision = ${result.candidate.revision},
        updated_at = ${result.candidate.updatedAt}
      WHERE id = ${command.candidate.id} AND revision = ${command.candidate.revision}
        AND status = 'PENDING_REVIEW' RETURNING id`);
    const sessionUpdate = await db.execute(sql`UPDATE resolution_sessions
      SET status = ${session.status}, selected_candidate_id = ${session.selectedCandidateId},
        resolution_decision_id = ${session.resolutionDecisionId}, revision = ${session.revision},
        updated_at = ${session.updatedAt}
      WHERE id = ${command.session.id} AND revision = ${command.session.revision}
        AND status = 'NEEDS_REVIEW' RETURNING id`);
    if (!candidateUpdate.rows.length || !sessionUpdate.rows.length)
      throw new AppError({
        code: "CONFLICT_REVISION_MISMATCH",
        message: "The resource has changed since it was read.",
        statusCode: 412,
      });
    await db.execute(sql`INSERT INTO candidate_resolution_idempotency
      (user_id, idempotency_key, request_hash, candidate_id, decision_id, created_at)
      VALUES (${command.actorUserId}, ${command.idempotencyKey}, ${command.requestHash},
        ${result.candidate.id}, ${result.decision.id}, ${result.decision.decidedAt})`);
    await this.recordCandidate(
      result.candidate,
      "USER",
      command.actorUserId,
      "CANDIDATE_RESOLUTION_DECIDED",
    );
    await this.recordSession(session, command.actorUserId, "RESOLUTION_DECIDED");
    return { session, candidate: result.candidate, decision: result.decision };
  }

  async recordEntityMatch(
    command: Parameters<ResolutionRepository["recordEntityMatch"]>[0],
  ): Promise<EntityMatch> {
    this.requireTransaction();
    parseIdempotencyKey(command.idempotencyKey, { required: true });
    if (
      !["USER", "SERVICE"].includes(command.producerType) ||
      !command.producerId.trim() ||
      command.producerId.length > 255
    )
      this.invalidMatch();
    const db = this.database.connection();
    const replayLock = `entity-match:${command.producerType}:${command.producerId}:${command.idempotencyKey}`;
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${replayLock}, 0))`,
    );
    const replay = await db.execute(sql`SELECT entity_match_id
      FROM resolution_entity_match_idempotency
      WHERE producer_type = ${command.producerType}
        AND producer_id = ${command.producerId}
        AND idempotency_key = ${command.idempotencyKey}`);
    const replayId = (replay.rows[0] as { entity_match_id: string } | undefined)
      ?.entity_match_id;
    if (replayId) {
      const existing = await this.findEntityMatch(replayId);
      if (!existing || !sameEntityMatch(existing, command)) this.idempotencyConflict();
      return existing;
    }

    const current = await db.execute(sql`SELECT id FROM candidates
      WHERE id = ${command.candidate.id}
        AND resolution_session_id = ${command.candidate.resolutionSessionId}
        AND workspace_id = ${command.candidate.workspaceId}
        AND case_id = ${command.candidate.caseId}
        AND status = 'PENDING_REVIEW'
        AND revision = ${command.candidate.revision}
      FOR UPDATE`);
    if (!current.rows.length)
      throw new AppError({
        code: "CANDIDATE_NOT_FOUND",
        message: "Candidate was not found.",
        statusCode: 404,
      });

    const snapshotLock = `entity-match-snapshot:${command.candidate.id}:${command.entity.id}:${command.candidate.revision}:${command.entity.revision}:1`;
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${snapshotLock}, 0))`,
    );
    const snapshot = await this.findEntityMatchSnapshot(
      command.candidate.id,
      command.entity.id,
      command.candidate.revision,
      command.entity.revision,
    );
    if (snapshot) {
      if (!sameEntityMatch(snapshot, command)) this.matchSnapshotConflict();
      await this.recordMatchIdempotency(snapshot, command);
      return snapshot;
    }

    const value = createEntityMatch(
      {
        id: newUuid(),
        candidate: command.candidate,
        entity: command.entity,
        matchLevel: command.matchLevel,
        signals: command.signals.map((signal) => ({ ...signal, id: newUuid() })),
      },
      new Date(),
    );
    await db.execute(sql`INSERT INTO resolution_entity_matches
      (id, resolution_session_id, candidate_id, candidate_revision, entity_id,
       entity_revision, workspace_id, case_id, match_level, policy_version,
       producer_type, producer_id, created_at)
      VALUES (${value.id}, ${value.resolutionSessionId}, ${value.candidateId},
        ${value.candidateRevision}, ${value.entityRef.id}, ${value.entityRevision},
        ${value.workspaceId}, ${value.caseId}, ${value.matchLevel}, 1,
        ${command.producerType}, ${command.producerId}, ${value.createdAt})`);
    for (const [ordinal, signal] of [...value.signals, ...value.conflicts].entries())
      await db.execute(sql`INSERT INTO resolution_match_signals
        (id, entity_match_id, ordinal, signal_kind, signal_field, result, strength,
         classification, value_visibility, created_at)
        VALUES (${signal.id}, ${value.id}, ${ordinal}, ${signal.kind}, ${signal.field},
          ${signal.result}, ${signal.strength}, ${signal.classification},
          ${signal.valueVisibility}, ${signal.createdAt})`);
    await this.recordMatchIdempotency(value, command);
    await this.outbox.enqueue({
      type: "ENTITY_MATCH_RECORDED",
      version: 1,
      aggregate: { type: "ENTITY_MATCH", id: value.id },
      payload: {
        entityMatchId: value.id,
        resolutionSessionId: value.resolutionSessionId,
        candidateId: value.candidateId,
        workspaceId: value.workspaceId,
        caseId: value.caseId,
        policyVersion: value.policyVersion,
      },
      occurredAt: new Date(value.createdAt),
    });
    return value;
  }

  async findEntityMatch(id: string): Promise<EntityMatch | undefined> {
    const result = await this.database
      .connection()
      .execute(entityMatchQuery(sql`m.id = ${id}`));
    return result.rows[0] ? mapEntityMatch(result.rows[0] as EntityMatchRow) : undefined;
  }

  async listEntityMatches(
    resolutionSessionId: string,
    limit: number,
    before?: string,
    includeProtected = true,
  ): Promise<EntityMatch[]> {
    const bound = Math.max(1, Math.min(101, Math.floor(limit)));
    const result = await this.database.connection().execute(sql`SELECT m.*,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'entityMatchId', s.entity_match_id, 'kind', s.signal_kind,
        'field', s.signal_field, 'result', s.result, 'strength', s.strength,
        'classification', s.classification, 'valueVisibility', s.value_visibility,
        'createdAt', s.created_at
      ) ORDER BY s.ordinal) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS signals
      FROM resolution_entity_matches m
      LEFT JOIN resolution_match_signals s ON s.entity_match_id = m.id
      WHERE m.resolution_session_id = ${resolutionSessionId}
        ${before ? sql`AND m.id < ${before}::uuid` : sql``}
        AND EXISTS (
          SELECT 1 FROM resolution_match_signals visible
          WHERE visible.entity_match_id = m.id
            AND visible.value_visibility <> 'HIDDEN'
            ${
              includeProtected
                ? sql``
                : sql`AND visible.classification IN ('PUBLIC', 'INTERNAL')`
            }
        )
      GROUP BY m.id ORDER BY m.id DESC LIMIT ${bound}`);
    return (result.rows as EntityMatchRow[]).map(mapEntityMatch);
  }

  private async findEntityMatchSnapshot(
    candidateId: string,
    entityId: string,
    candidateRevision: number,
    entityRevision: number,
  ): Promise<EntityMatch | undefined> {
    const result = await this.database.connection().execute(
      entityMatchQuery(sql`m.candidate_id = ${candidateId}
        AND m.entity_id = ${entityId}
        AND m.candidate_revision = ${candidateRevision}
        AND m.entity_revision = ${entityRevision}
        AND m.policy_version = 1`),
    );
    return result.rows[0] ? mapEntityMatch(result.rows[0] as EntityMatchRow) : undefined;
  }

  private async recordMatchIdempotency(
    value: EntityMatch,
    command: Parameters<ResolutionRepository["recordEntityMatch"]>[0],
  ): Promise<void> {
    await this.database.connection()
      .execute(sql`INSERT INTO resolution_entity_match_idempotency
      (producer_type, producer_id, idempotency_key, entity_match_id, created_at)
      VALUES (${command.producerType}, ${command.producerId}, ${command.idempotencyKey},
        ${value.id}, ${value.createdAt})`);
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
    eventType = "CANDIDATE_CREATED",
  ): Promise<void> {
    await this.database.connection().execute(sql`INSERT INTO candidate_revisions
      (candidate_id, revision, status, actor_type, actor_id, occurred_at)
      VALUES (${value.id}, ${value.revision}, ${value.status}, ${actorType}, ${actorId},
        ${value.updatedAt})`);
    await this.outbox.enqueue({
      type: eventType,
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

  private async findDecision(id: string): Promise<ResolutionDecision | undefined> {
    const result = await this.database.connection().execute(sql`SELECT *
      FROM resolution_decisions WHERE id = ${id}`);
    return result.rows[0]
      ? mapDecision(result.rows[0] as ResolutionDecisionRow)
      : undefined;
  }

  private candidateNotFound(): never {
    throw new AppError({
      code: "CANDIDATE_NOT_FOUND",
      message: "Candidate was not found.",
      statusCode: 404,
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

  private invalidMatch(): never {
    throw new AppError({
      code: "VALIDATION_MATCH_SIGNAL_INVALID",
      message: "Entity match signal input is invalid.",
      statusCode: 400,
    });
  }

  private matchSnapshotConflict(): never {
    throw new AppError({
      code: "ENTITY_MATCH_SNAPSHOT_CONFLICT",
      message: "The Entity match snapshot already exists with different signals.",
      statusCode: 409,
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
type ResolutionDecisionRow = {
  id: string;
  resolution_session_id: string;
  candidate_id: string;
  decision: ResolutionDecision["decision"];
  target_entity_id: string | null;
  reason_code: ResolutionDecision["reasonCode"];
  decided_by_user_id: string;
  decided_at: Date | string;
};
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

type SignalRow = {
  id: string;
  entityMatchId: string;
  kind: MatchSignalKind;
  field: MatchSignalField;
  result: MatchSignalResult;
  strength: MatchSignalStrength;
  classification: Candidate["classification"];
  valueVisibility: EntityMatch["signals"][number]["valueVisibility"];
  createdAt: string;
};

type EntityMatchRow = {
  id: string;
  resolution_session_id: string;
  candidate_id: string;
  candidate_revision: number;
  entity_id: string;
  entity_revision: number;
  workspace_id: string;
  case_id: string;
  match_level: EntityMatch["matchLevel"];
  policy_version: 1;
  created_at: Date | string;
  signals: SignalRow[];
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

function mapDecision(row: ResolutionDecisionRow): ResolutionDecision {
  return Object.freeze({
    id: row.id,
    resolutionSessionId: row.resolution_session_id,
    candidateId: row.candidate_id,
    decision: row.decision,
    targetEntityId: row.target_entity_id,
    reasonCode: row.reason_code,
    decidedByUserId: row.decided_by_user_id,
    decidedAt: new Date(row.decided_at).toISOString(),
  });
}

function entityMatchQuery(predicate: ReturnType<typeof sql>) {
  return sql`SELECT m.*,
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'entityMatchId', s.entity_match_id, 'kind', s.signal_kind,
      'field', s.signal_field, 'result', s.result, 'strength', s.strength,
      'classification', s.classification, 'valueVisibility', s.value_visibility,
      'createdAt', s.created_at
    ) ORDER BY s.ordinal) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS signals
    FROM resolution_entity_matches m
    LEFT JOIN resolution_match_signals s ON s.entity_match_id = m.id
    WHERE ${predicate} GROUP BY m.id LIMIT 1`;
}

function mapEntityMatch(row: EntityMatchRow): EntityMatch {
  const all = (row.signals ?? []).map((signal) =>
    Object.freeze({ ...signal, createdAt: new Date(signal.createdAt).toISOString() }),
  );
  return Object.freeze({
    id: row.id,
    resolutionSessionId: row.resolution_session_id,
    candidateId: row.candidate_id,
    candidateRevision: Number(row.candidate_revision),
    workspaceId: row.workspace_id,
    caseId: row.case_id,
    entityRef: Object.freeze({
      type: "ENTITY" as const,
      id: row.entity_id,
      workspaceId: row.workspace_id,
    }),
    entityRevision: Number(row.entity_revision),
    matchLevel: row.match_level,
    policyVersion: 1,
    signals: Object.freeze(all.filter((signal) => signal.kind === "MATCHING")),
    conflicts: Object.freeze(
      all.filter(
        (signal): signal is typeof signal & { kind: "CONFLICT" } =>
          signal.kind === "CONFLICT",
      ),
    ),
    createdAt: new Date(row.created_at).toISOString(),
  });
}

function sameEntityMatch(
  current: EntityMatch,
  requested: Parameters<ResolutionRepository["recordEntityMatch"]>[0],
): boolean {
  const currentSignals = [...current.signals, ...current.conflicts];
  const requestedSignals = [
    ...requested.signals.filter((signal) => signal.kind === "MATCHING"),
    ...requested.signals.filter((signal) => signal.kind === "CONFLICT"),
  ];
  return (
    current.candidateId === requested.candidate.id &&
    current.candidateRevision === requested.candidate.revision &&
    current.workspaceId === requested.candidate.workspaceId &&
    current.caseId === requested.candidate.caseId &&
    current.entityRef.id === requested.entity.id &&
    current.entityRef.workspaceId === requested.entity.workspaceId &&
    current.entityRevision === requested.entity.revision &&
    current.matchLevel === requested.matchLevel &&
    currentSignals.length === requestedSignals.length &&
    currentSignals.every((signal, index) => sameSignal(signal, requestedSignals[index]))
  );
}

function sameSignal(
  current: EntityMatch["signals"][number],
  requested: CreateMatchSignalInput | undefined,
): boolean {
  return Boolean(
    requested &&
    current.kind === requested.kind &&
    current.field === requested.field &&
    current.result === requested.result &&
    current.strength === requested.strength &&
    current.classification === requested.classification &&
    current.valueVisibility === requested.valueVisibility,
  );
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

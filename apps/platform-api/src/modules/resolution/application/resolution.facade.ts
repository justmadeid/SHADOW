import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DrizzleTransactionManager } from "@intelligence/database";
import { isResourceId } from "@intelligence/contracts";
import { AuditFacade } from "../../audit/index.js";
import { EntityFacade, IDENTIFIER_ACCESS_REASONS } from "../../entity/index.js";
import { PolicyEnforcer } from "../../governance/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/http/cursor.js";
import { SubjectFacade } from "../../subject/index.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import { parseIdempotencyKey } from "../../../platform/http/idempotency.js";
import {
  RESOLUTION_REPOSITORY,
  type ResolutionRepository,
} from "../domain/resolution-repository.js";
import { presentEntityMatchView } from "../domain/matching-signal.js";
import {
  RESTRICTED_CANDIDATE_LABEL,
  RESOLUTION_DECISIONS,
  RESOLUTION_REASON_CODES,
  type ResolutionDecisionType,
  type ResolutionReasonCode,
} from "../domain/candidate.js";
import type { ResolutionSession } from "../domain/resolution-session.js";

@Injectable()
export class ResolutionFacade {
  constructor(
    @Inject(RESOLUTION_REPOSITORY)
    private readonly repository: ResolutionRepository,
    @Inject(SubjectFacade) private readonly subjects: SubjectFacade,
    @Inject(EntityFacade) private readonly entities: EntityFacade,
    @Inject(PolicyEnforcer) private readonly policy: PolicyEnforcer,
    @Inject(AuditFacade) private readonly audit: AuditFacade,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(RequestContextStore) private readonly context: RequestContextStore,
  ) {}

  async start(subjectId: string, expectedRevision: number, idempotencyKey: string) {
    const actorUserId = this.requireUser();
    parseIdempotencyKey(idempotencyKey, { required: true });
    return this.subjects.withResolutionAccess(subjectId, async (subject) => {
      const requestHash = digest({
        subjectId,
        workspaceId: subject.workspaceId,
        caseId: subject.caseId,
        expectedRevision,
      });
      const created = await this.repository.createSession({
        workspaceId: subject.workspaceId,
        caseId: subject.caseId,
        subjectId,
        actorUserId,
        idempotencyKey,
        requestHash,
      });
      if (created.replayed) return { resolution: created.session, subject };
      const transitioned = await this.subjects.startResolutionTransition(
        subject,
        expectedRevision,
      );
      return { resolution: created.session, subject: transitioned };
    });
  }

  async decide(
    candidateId: string,
    input: ResolveCandidateInput,
    expectedRevision: number,
    idempotencyKey: string,
    operationId: string,
  ) {
    const actorUserId = this.requireUser();
    parseIdempotencyKey(idempotencyKey, { required: true });
    const normalized = parseResolveCandidate(input);
    const visible = await this.getCandidate(candidateId);
    return this.subjects.withResolutionAccess(visible.subjectId, async (subject) => {
      if (
        subject.id !== visible.subjectId ||
        subject.workspaceId !== visible.workspaceId ||
        subject.caseId !== visible.caseId
      )
        return this.candidateNotFound();
      const requestHash = digest({
        candidateId,
        decision: normalized.decision,
        entityId: normalized.entityId ?? null,
        reasonCode: normalized.reasonCode,
        expectedRevision,
        operationId,
      });
      const prepared = await this.repository.prepareCandidateDecision({
        candidateId,
        actorUserId,
        idempotencyKey,
        requestHash,
      });
      if (prepared.replayed)
        return {
          decision: prepared.decision,
          candidate: prepared.candidate,
          resolution: prepared.session,
          subject,
        };
      if (subject.status !== "RESOLVING")
        throw new AppError({
          code: "RESOLUTION_SUBJECT_NOT_RESOLVING",
          message: "The Subject is not in an active resolution lifecycle.",
          statusCode: 409,
        });
      assertExpectedRevision(expectedRevision, prepared.candidate.revision);

      let targetEntityId: string | null = null;
      if (normalized.decision === "LINK_EXISTING") {
        const entity = await this.entities.resolveForResolution(
          prepared.candidate.workspaceId,
          normalized.entityId!,
        );
        if (!entity || entity.type !== prepared.candidate.type)
          throw new AppError({
            code: "CANDIDATE_RESOLUTION_ENTITY_INVALID",
            message: "The target Entity is unavailable or incompatible.",
            statusCode: 409,
          });
        targetEntityId = entity.id;
      } else if (normalized.decision === "CREATE_NEW") {
        if (
          prepared.candidate.classification === "RESTRICTED" ||
          prepared.candidate.displayLabel === RESTRICTED_CANDIDATE_LABEL
        )
          throw new AppError({
            code: "CANDIDATE_RESTRICTED_CREATE_NOT_ALLOWED",
            message: "A restricted Candidate cannot supply a canonical Entity label.",
            statusCode: 409,
          });
        const entity = await this.entities.createFromResolution(
          prepared.candidate.workspaceId,
          {
            type: prepared.candidate.type,
            canonicalLabel: prepared.candidate.displayLabel,
          },
          `candidate-resolution:${createHash("sha256").update(idempotencyKey).digest("hex")}`,
        );
        targetEntityId = entity.id;
      }

      let nextSubject = subject;
      if (targetEntityId)
        nextSubject = await this.subjects.resolveFromCandidate(
          subject,
          targetEntityId,
          this.entities,
        );
      else if (prepared.remainingPendingCandidates === 0)
        nextSubject = await this.subjects.failResolution(subject);

      const committed = await this.repository.commitCandidateDecision({
        session: prepared.session,
        candidate: prepared.candidate,
        remainingPendingCandidates: prepared.remainingPendingCandidates,
        decision: normalized.decision,
        targetEntityId,
        reasonCode: normalized.reasonCode,
        actorUserId,
        idempotencyKey,
        requestHash,
      });
      await this.audit.record({
        operationId,
        action: "CANDIDATE_RESOLUTION",
        outcome: "AUTHORIZED",
        classification: prepared.candidate.classification,
        reason: normalized.reasonCode,
        resource: {
          type: "CANDIDATE",
          id: prepared.candidate.id,
          workspaceId: prepared.candidate.workspaceId,
          caseId: prepared.candidate.caseId,
        },
        resourceRevision: committed.candidate.revision,
      });
      return {
        decision: committed.decision,
        candidate: committed.candidate,
        resolution: committed.session,
        subject: nextSubject,
      };
    });
  }

  async getSession(id: string): Promise<ResolutionSession> {
    const found = await this.repository.findSession(id);
    if (!found) return this.resolutionNotFound();
    await this.authorizeSubject(found.subjectId, "RESOLUTION_NOT_FOUND");
    return found;
  }

  async listCandidates(resolutionId: string, limit = 50, cursor?: string) {
    const session = await this.getSession(resolutionId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new AppError({
        code: "VALIDATION_INVALID_LIMIT",
        message: "Limit must be between 1 and 100.",
        statusCode: 400,
      });
    let before: string | undefined;
    if (cursor !== undefined) {
      const value = decodeCursor<unknown>(cursor);
      if (
        !value ||
        typeof value !== "object" ||
        !("resolutionId" in value) ||
        value.resolutionId !== resolutionId ||
        !("workspaceId" in value) ||
        value.workspaceId !== session.workspaceId ||
        !("caseId" in value) ||
        value.caseId !== session.caseId ||
        !("before" in value) ||
        typeof value.before !== "string" ||
        !isResourceId(value.before)
      )
        throw new AppError({
          code: "VALIDATION_INVALID_CURSOR",
          message: "Candidate cursor is invalid.",
          statusCode: 400,
        });
      before = value.before;
    }
    const rows = await this.repository.listCandidates(resolutionId, limit + 1, before);
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      items,
      page: {
        hasMore,
        nextCursor: hasMore
          ? encodeCursor({
              resolutionId,
              workspaceId: session.workspaceId,
              caseId: session.caseId,
              before: items.at(-1)!.id,
            })
          : null,
      },
    };
  }

  async getCandidate(id: string) {
    const found = await this.repository.findCandidate(id);
    if (!found) return this.candidateNotFound();
    const session = await this.repository.findSession(found.resolutionSessionId);
    if (
      !session ||
      session.subjectId !== found.subjectId ||
      session.workspaceId !== found.workspaceId ||
      session.caseId !== found.caseId
    )
      return this.candidateNotFound();
    await this.authorizeSubject(found.subjectId, "CANDIDATE_NOT_FOUND");
    return found;
  }

  async listMatches(
    resolutionId: string,
    limit = 50,
    cursor?: string,
    access: { reasonForAccess?: string; operationId?: string } = {},
  ) {
    const protectedAccess = parseMatchAccess(access);
    return this.transactions.run(async () => {
      const session = await this.getSession(resolutionId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new AppError({
          code: "VALIDATION_INVALID_LIMIT",
          message: "Limit must be between 1 and 100.",
          statusCode: 400,
        });
      let before: string | undefined;
      if (cursor !== undefined) {
        const value = decodeCursor<unknown>(cursor);
        if (
          !value ||
          typeof value !== "object" ||
          !("resolutionId" in value) ||
          value.resolutionId !== resolutionId ||
          !("workspaceId" in value) ||
          value.workspaceId !== session.workspaceId ||
          !("caseId" in value) ||
          value.caseId !== session.caseId ||
          !("before" in value) ||
          typeof value.before !== "string" ||
          !isResourceId(value.before)
        )
          throw new AppError({
            code: "VALIDATION_INVALID_CURSOR",
            message: "Entity match cursor is invalid.",
            statusCode: 400,
          });
        before = value.before;
      }

      const resource = {
        type: "WORKSPACE" as const,
        id: session.workspaceId,
        workspaceId: session.workspaceId,
      };
      const context = { caseId: session.caseId };
      await this.policy.enforce({
        action: "DISCOVER_ENTITY_EXISTENCE",
        resource,
        context,
      });
      const canViewCrossCaseContext = (
        await this.policy.decide({
          action: "VIEW_CROSS_CASE_CONTEXT",
          resource,
          context,
        })
      ).allowed;
      const canUseProtectedSignals = protectedAccess
        ? (
            await this.policy.decide({
              action: "IDENTIFIER_USE_RESTRICTED",
              resource,
              context: {
                ...context,
                reasonForAccess: protectedAccess.reasonForAccess,
              },
            })
          ).allowed
        : false;

      const rows = await this.repository.listEntityMatches(
        resolutionId,
        limit + 1,
        before,
        canUseProtectedSignals,
      );
      const pageRows = rows.slice(0, limit);
      const activeEntities = await this.entities.resolveMany(
        session.workspaceId,
        pageRows.map((match) => match.entityRef.id),
      );
      const eligibleRows = pageRows.filter((match) =>
        activeEntities.has(match.entityRef.id),
      );
      const items = eligibleRows.flatMap((match) => {
        const view = presentEntityMatchView(match, {
          canDiscoverEntity: true,
          canUseProtectedSignals,
          canViewCrossCaseContext,
        });
        return view ? [view] : [];
      });
      const disclosedProtected =
        canUseProtectedSignals &&
        eligibleRows.some((match) =>
          [...match.signals, ...match.conflicts].some(
            (signal) =>
              signal.valueVisibility !== "HIDDEN" &&
              ["SENSITIVE", "RESTRICTED"].includes(signal.classification),
          ),
        );
      if (disclosedProtected && protectedAccess)
        await this.audit.record({
          operationId: protectedAccess.operationId,
          action: "SENSITIVE_FIELD_MATCH",
          outcome: "AUTHORIZED",
          classification: "RESTRICTED",
          reason: protectedAccess.reasonForAccess,
          resource: {
            type: "CASE",
            id: session.caseId,
            workspaceId: session.workspaceId,
            caseId: session.caseId,
          },
          resourceRevision: session.revision,
        });

      const hasMore = rows.length > limit;
      return {
        items,
        page: {
          hasMore,
          nextCursor: hasMore
            ? encodeCursor({
                resolutionId,
                workspaceId: session.workspaceId,
                caseId: session.caseId,
                before: pageRows.at(-1)!.id,
              })
            : null,
        },
      };
    });
  }

  private async authorizeSubject(
    subjectId: string,
    notFoundCode: "RESOLUTION_NOT_FOUND" | "CANDIDATE_NOT_FOUND",
  ): Promise<void> {
    try {
      await this.subjects.get(subjectId);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        if (notFoundCode === "CANDIDATE_NOT_FOUND") return this.candidateNotFound();
        return this.resolutionNotFound();
      }
      throw error;
    }
  }

  private resolutionNotFound(): never {
    throw new AppError({
      code: "RESOLUTION_NOT_FOUND",
      message: "Resolution session was not found.",
      statusCode: 404,
    });
  }

  private candidateNotFound(): never {
    throw new AppError({
      code: "CANDIDATE_NOT_FOUND",
      message: "Candidate was not found.",
      statusCode: 404,
    });
  }

  private requireUser(): string {
    const principal = this.context.get().principal;
    if (!principal || principal.kind !== "USER")
      throw new AppError({
        code: "AUTH_USER_REQUIRED",
        message: "This operation requires an authenticated user.",
        statusCode: 403,
      });
    return principal.userId;
  }
}

export type ResolveCandidateInput = {
  decision: ResolutionDecisionType;
  entityId?: string;
  reasonCode: ResolutionReasonCode;
};

export function parseResolveCandidate(input: unknown): ResolveCandidateInput {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !["decision", "entityId", "reasonCode"].includes(key),
    )
  )
    return invalidDecision();
  const value = input as Record<string, unknown>;
  if (
    typeof value.decision !== "string" ||
    !RESOLUTION_DECISIONS.includes(value.decision as ResolutionDecisionType) ||
    typeof value.reasonCode !== "string" ||
    !RESOLUTION_REASON_CODES.includes(value.reasonCode as ResolutionReasonCode)
  )
    return invalidDecision();
  const requiresExisting = value.decision === "LINK_EXISTING";
  if (
    requiresExisting !== (typeof value.entityId === "string") ||
    (typeof value.entityId === "string" && !isResourceId(value.entityId))
  )
    return invalidDecision();
  return {
    decision: value.decision as ResolutionDecisionType,
    reasonCode: value.reasonCode as ResolutionReasonCode,
    ...(typeof value.entityId === "string" ? { entityId: value.entityId } : {}),
  };
}

function invalidDecision(): never {
  throw new AppError({
    code: "VALIDATION_CANDIDATE_RESOLUTION_INVALID",
    message: "Candidate resolution input is invalid.",
    statusCode: 400,
  });
}

function digest(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseMatchAccess(input: {
  reasonForAccess?: string;
  operationId?: string;
}): { reasonForAccess: string; operationId: string } | null {
  if (input.reasonForAccess === undefined && input.operationId === undefined) return null;
  if (
    typeof input.reasonForAccess !== "string" ||
    !(IDENTIFIER_ACCESS_REASONS as readonly string[]).includes(
      input.reasonForAccess.trim(),
    )
  )
    throw new AppError({
      code: "VALIDATION_REASON_FOR_ACCESS_INVALID",
      message: "X-Reason-For-Access must be a registered Identifier access reason.",
      statusCode: 400,
    });
  if (!input.operationId)
    throw new AppError({
      code: "VALIDATION_AUDIT_OPERATION_ID_REQUIRED",
      message: "X-Audit-Operation-Id is required for protected match access.",
      statusCode: 400,
    });
  if (!isResourceId(input.operationId))
    throw new AppError({
      code: "VALIDATION_AUDIT_OPERATION_ID_INVALID",
      message: "X-Audit-Operation-Id must be a valid UUID.",
      statusCode: 400,
    });
  return {
    reasonForAccess: input.reasonForAccess.trim(),
    operationId: input.operationId,
  };
}

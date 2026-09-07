import { Inject, Injectable } from "@nestjs/common";
import { DrizzleTransactionManager } from "@intelligence/database";
import { EntityFacade } from "../../entity/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { parseIdempotencyKey } from "../../../platform/http/idempotency.js";
import type {
  CreateMatchSignalInput,
  EntityMatch,
  MatchLevel,
} from "../domain/matching-signal.js";
import {
  RESOLUTION_REPOSITORY,
  type ResolutionRepository,
} from "../domain/resolution-repository.js";

/** Trusted application port for P2-007 matching. It is intentionally not an HTTP API. */
@Injectable()
export class ResolutionMatchFacade {
  constructor(
    @Inject(RESOLUTION_REPOSITORY)
    private readonly repository: ResolutionRepository,
    @Inject(EntityFacade) private readonly entities: EntityFacade,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
  ) {}

  async record(input: {
    candidateId: string;
    entityId: string;
    matchLevel: MatchLevel;
    signals: readonly CreateMatchSignalInput[];
    producerType: "USER" | "SERVICE";
    producerId: string;
    idempotencyKey: string;
  }): Promise<EntityMatch> {
    parseIdempotencyKey(input.idempotencyKey, { required: true });
    return this.transactions.run(async () => {
      const candidate = await this.repository.findCandidate(input.candidateId);
      if (!candidate || candidate.status !== "PENDING_REVIEW") this.candidateNotFound();
      const session = await this.repository.findSession(candidate.resolutionSessionId);
      if (
        !session ||
        session.status !== "NEEDS_REVIEW" ||
        session.subjectId !== candidate.subjectId ||
        session.workspaceId !== candidate.workspaceId ||
        session.caseId !== candidate.caseId
      )
        this.candidateNotFound();

      const entity = await this.entities.resolve(candidate.workspaceId, input.entityId);
      if (!entity || entity.type !== candidate.type)
        throw new AppError({
          code: "ENTITY_MATCH_TARGET_INVALID",
          message: "Entity match target is unavailable or incompatible.",
          statusCode: 409,
        });

      return this.repository.recordEntityMatch({
        candidate,
        entity: {
          id: entity.id,
          workspaceId: entity.workspaceId,
          type: candidate.type,
          revision: entity.revision,
        },
        matchLevel: input.matchLevel,
        signals: input.signals,
        producerType: input.producerType,
        producerId: input.producerId,
        idempotencyKey: input.idempotencyKey,
      });
    });
  }

  private candidateNotFound(): never {
    throw new AppError({
      code: "CANDIDATE_NOT_FOUND",
      message: "Candidate was not found.",
      statusCode: 404,
    });
  }
}

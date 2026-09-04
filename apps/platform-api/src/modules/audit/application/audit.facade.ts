import { Inject, Injectable } from "@nestjs/common";
import { currentTransaction, markTransactionRollbackOnly } from "@intelligence/database";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { newUuid } from "../../../platform/ids/uuid.js";
import {
  validateAuditInput,
  type AuditInput,
  type AuditStore,
} from "../domain/audit-event.js";
import { AUDIT_STORE } from "../audit.tokens.js";

@Injectable()
export class AuditFacade {
  constructor(
    @Inject(AUDIT_STORE) private readonly store: AuditStore,
    @Inject(RequestContextStore) private readonly context: RequestContextStore,
  ) {}

  async record(input: AuditInput): Promise<string> {
    if (!currentTransaction())
      throw new AppError({
        code: "AUDIT_TRANSACTION_REQUIRED",
        message: "Critical audit requires the business transaction.",
        statusCode: 500,
      });
    try {
      validateAuditInput(input);
      const context = this.context.get();
      const actor = context.principal;
      if (!actor)
        throw new AppError({
          code: "AUDIT_ACTOR_REQUIRED",
          message: "Critical audit requires an authenticated actor.",
          statusCode: 403,
        });
      const actorId = actor.kind === "USER" ? actor.userId : actor.serviceId;
      if (
        !actorId.trim() ||
        actorId.length > 255 ||
        !context.requestId ||
        context.requestId.length > 128 ||
        !context.traceId ||
        context.traceId.length > 128
      )
        throw new AppError({
          code: "AUDIT_INPUT_INVALID",
          message: "Audit context is invalid.",
          statusCode: 400,
        });
      return await this.store.append({
        id: newUuid(),
        version: 1,
        operationId: input.operationId,
        action: input.action,
        outcome: input.outcome,
        workspaceId: input.resource.workspaceId,
        caseId: input.resource.caseId ?? null,
        resourceType: input.resource.type,
        resourceId: input.resource.id,
        actorType: actor.kind,
        actorId,
        requestId: context.requestId,
        traceId: context.traceId,
        reason: input.reason?.trim() ?? null,
        classification: input.classification ?? null,
        membershipId: input.membershipId ?? null,
        resourceRevision: input.resourceRevision ?? null,
        occurredAt: new Date(),
      });
    } catch (error) {
      markTransactionRollbackOnly();
      if (error instanceof AppError && error.code.startsWith("AUDIT_")) throw error;
      // SQL errors can embed bound parameters (actor/reason). Never forward cause.
      throw new AppError({
        code: "AUDIT_DURABILITY_FAILED",
        message: "Required audit could not be persisted.",
        statusCode: 503,
      });
    }
  }
}

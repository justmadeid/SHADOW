import { Inject, Injectable } from "@nestjs/common";
import { DrizzleTransactionManager } from "@intelligence/database";
import { isResourceId } from "@intelligence/contracts";
import { AuditFacade } from "../../audit/index.js";
import { CaseFacade } from "../../case/index.js";
import { AuditedDataAccess, PolicyEnforcer } from "../../governance/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { newUuid } from "../../../platform/ids/uuid.js";
import { parseIdempotencyKey } from "../../../platform/http/idempotency.js";
import { EntityFacade } from "./entity.facade.js";
import {
  maskedIdentifier,
  normalizeCreateIdentifier,
  normalizeIdentifierValue,
  type CreateIdentifierInput,
  type IdentifierType,
  type IdentifierView,
} from "../domain/identifier.js";
import {
  IDENTIFIER_REPOSITORY,
  type IdentifierRepository,
} from "../domain/identifier-repository.js";

export const IDENTIFIER_ACCESS_REASONS = [
  "IDENTITY_VERIFICATION",
  "DUPLICATE_REVIEW",
  "AUTHORIZED_INVESTIGATION",
  "DATA_QUALITY_REVIEW",
] as const;

@Injectable()
export class IdentifierFacade {
  constructor(
    @Inject(IDENTIFIER_REPOSITORY)
    private readonly repository: IdentifierRepository,
    @Inject(EntityFacade) private readonly entities: EntityFacade,
    @Inject(PolicyEnforcer) private readonly policy: PolicyEnforcer,
    @Inject(AuditedDataAccess) private readonly audited: AuditedDataAccess,
    @Inject(AuditFacade) private readonly audit: AuditFacade,
    @Inject(CaseFacade) private readonly cases: CaseFacade,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(RequestContextStore) private readonly context: RequestContextStore,
  ) {}

  async create(
    entityId: string,
    input: CreateIdentifierInput,
    idempotencyKey: string,
  ): Promise<IdentifierView> {
    const actorUserId = this.requireUser();
    const normalized = normalizeCreateIdentifier(input);
    parseIdempotencyKey(idempotencyKey, { required: true });
    const value = await this.transactions.run(async () => {
      const entity = await this.entities.get(entityId);
      if (entity.status !== "ACTIVE") this.notFound();
      await this.policy.enforce(
        {
          action: "WORKSPACE_MANAGE",
          resource: { type: "ENTITY", id: entity.id, workspaceId: entity.workspaceId },
        },
        {
          hideExistence: true,
          notFoundCode: "ENTITY_NOT_FOUND",
          notFoundMessage: "Entity was not found.",
        },
      );
      return this.repository.create({
        ...normalized,
        entityId: entity.id,
        workspaceId: entity.workspaceId,
        actorUserId,
        idempotencyKey,
      });
    });
    return maskedIdentifier(value);
  }

  async list(entityId: string): Promise<{ items: IdentifierView[] }> {
    this.requireUser();
    const entity = await this.entities.get(entityId);
    const values = await this.repository.list(entity.id, entity.workspaceId);
    return { items: values.map(maskedIdentifier) };
  }

  /** Trusted P2-009 read port. Caller must first authorize the linked Subject/Case. */
  async listForTargetProfile(
    entityId: string,
    workspaceId: string,
  ): Promise<{ items: IdentifierView[] }> {
    this.requireUser();
    const values = await this.repository.list(entityId, workspaceId);
    return { items: values.map(maskedIdentifier) };
  }

  async get(
    identifierId: string,
    options: { reasonForAccess?: string; operationId?: string },
  ): Promise<IdentifierView> {
    this.requireUser();
    const identifier = await this.repository.find(identifierId);
    if (!identifier) this.notFound();
    const entity = await this.entities.get(identifier.entityId);
    if (entity.workspaceId !== identifier.workspaceId) this.notFound();
    if (identifier.status !== "ACTIVE") return maskedIdentifier(identifier);
    const reason = parseReason(options.reasonForAccess);
    if (reason && !options.operationId)
      throw new AppError({
        code: "VALIDATION_AUDIT_OPERATION_ID_REQUIRED",
        message: "X-Audit-Operation-Id is required for an Identifier access reason.",
        statusCode: 400,
      });
    const operationId = options.operationId ?? newUuid();
    if (!isResourceId(operationId))
      throw new AppError({
        code: "VALIDATION_AUDIT_OPERATION_ID_INVALID",
        message: "X-Audit-Operation-Id must be a valid UUID.",
        statusCode: 400,
      });
    const field = await this.audited.display(
      {
        access: {
          action: "WORKSPACE_VIEW",
          resource: {
            type: "IDENTIFIER",
            id: identifier.id,
            workspaceId: identifier.workspaceId,
          },
          context: reason ? { reasonForAccess: reason } : {},
        },
        classification: identifier.classification,
        fieldKind: "IDENTIFIER",
      },
      { operationId, resourceRevision: identifier.revision },
      async (visibility) =>
        visibility === "FULL"
          ? { value: await this.repository.reveal(identifier.id) }
          : { matchStatus: "UNKNOWN" },
    );
    return Object.freeze({ ...identifier, ...field });
  }

  /**
   * Trusted P2-007 port. The protected input is normalized in memory, converted to
   * a keyed Workspace fingerprint by the repository, and never returned or stored.
   */
  async matchExact(input: {
    workspaceId: string;
    caseId: string;
    type: IdentifierType;
    value: string;
    reasonForAccess: string;
    operationId: string;
  }) {
    if (!isResourceId(input.workspaceId) || !isResourceId(input.caseId))
      throw new AppError({
        code: "VALIDATION_INVALID_RESOURCE_ID",
        message: "Resource ID must be a valid UUID.",
        statusCode: 400,
      });
    const reason = parseReason(input.reasonForAccess);
    if (!reason)
      throw new AppError({
        code: "VALIDATION_REASON_FOR_ACCESS_REQUIRED",
        message: "A registered Identifier access reason is required.",
        statusCode: 400,
      });
    if (!isResourceId(input.operationId))
      throw new AppError({
        code: "VALIDATION_AUDIT_OPERATION_ID_INVALID",
        message: "Audit operation ID must be a valid UUID.",
        statusCode: 400,
      });
    const normalizedValue = normalizeIdentifierValue(input.type, input.value);
    return this.transactions.run(async () => {
      const parent = await this.cases.get(input.caseId);
      if (parent.workspaceId !== input.workspaceId)
        throw new AppError({
          code: "ACCESS_DENIED",
          message: "The authenticated principal is not allowed to perform this action.",
          statusCode: 403,
        });
      const resource = {
        type: "WORKSPACE" as const,
        id: input.workspaceId,
        workspaceId: input.workspaceId,
      };
      await this.policy.enforce({
        action: "DISCOVER_ENTITY_EXISTENCE",
        resource,
        context: { caseId: input.caseId },
      });
      await this.policy.enforce({
        action: "IDENTIFIER_USE_RESTRICTED",
        resource,
        context: { caseId: input.caseId, reasonForAccess: reason },
      });
      const matches = await this.repository.findExactMatches({
        workspaceId: input.workspaceId,
        type: input.type,
        normalizedValue,
        limit: 2,
      });
      await this.audit.record({
        operationId: input.operationId,
        action: "SENSITIVE_FIELD_MATCH",
        outcome: "AUTHORIZED",
        classification: "RESTRICTED",
        reason,
        resource: {
          type: "CASE",
          id: input.caseId,
          workspaceId: input.workspaceId,
          caseId: input.caseId,
        },
      });
      return Object.freeze(matches.map((match) => Object.freeze(match)));
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

  private notFound(): never {
    throw new AppError({
      code: "IDENTIFIER_NOT_FOUND",
      message: "Identifier was not found.",
      statusCode: 404,
    });
  }
}

function parseReason(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const reason = value.trim();
  if (!(IDENTIFIER_ACCESS_REASONS as readonly string[]).includes(reason))
    throw new AppError({
      code: "VALIDATION_REASON_FOR_ACCESS_INVALID",
      message: "X-Reason-For-Access must be a registered Identifier access reason.",
      statusCode: 400,
    });
  return reason;
}

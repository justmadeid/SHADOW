import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DrizzleTransactionManager } from "@intelligence/database";
import { isResourceId } from "@intelligence/contracts";
import { AuditFacade } from "../../audit/index.js";
import { PolicyEnforcer } from "../../governance/index.js";
import { WorkspaceFacade } from "../../workspace/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/http/cursor.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import { parseIdempotencyKey } from "../../../platform/http/idempotency.js";
import { ENTITY_REPOSITORY, type EntityRepository } from "../domain/entity-repository.js";
import {
  normalizeCreateEntity,
  type CreateEntityInput,
  type Entity,
  type EntityMergeDecision,
  type EntityMergeReversalDecision,
  type MergeEntityInput,
  type ReverseEntityMergeInput,
  type UpdateEntityInput,
} from "../domain/entity.js";
import {
  parseMergeEntity,
  parseReverseEntityMerge,
  parseUpdateEntity,
} from "../domain/entity-input.js";

@Injectable()
export class EntityFacade {
  constructor(
    @Inject(ENTITY_REPOSITORY) private readonly repository: EntityRepository,
    @Inject(WorkspaceFacade) private readonly workspaces: WorkspaceFacade,
    @Inject(PolicyEnforcer) private readonly policy: PolicyEnforcer,
    @Inject(AuditFacade) private readonly audit: AuditFacade,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(RequestContextStore) private readonly context: RequestContextStore,
  ) {}

  async create(
    workspaceId: string,
    input: CreateEntityInput,
    idempotencyKey: string,
  ): Promise<Entity> {
    const actorUserId = this.requireUser();
    const normalized = normalizeCreateEntity(input);
    parseIdempotencyKey(idempotencyKey, { required: true });
    return this.transactions.run(async () => {
      await this.authorizeWorkspace(workspaceId, "WORKSPACE_MANAGE", false);
      return this.repository.create({
        ...normalized,
        workspaceId,
        actorUserId,
        idempotencyKey,
      });
    });
  }

  /** Trusted Candidate-resolution port. Caller owns authorization and transaction. */
  async createFromResolution(
    workspaceId: string,
    input: CreateEntityInput,
    idempotencyKey: string,
  ): Promise<Entity> {
    const actorUserId = this.requireUser();
    const normalized = normalizeCreateEntity(input);
    parseIdempotencyKey(idempotencyKey, { required: true });
    return this.repository.create({
      ...normalized,
      workspaceId,
      actorUserId,
      idempotencyKey,
    });
  }

  async get(id: string): Promise<Entity> {
    this.requireUser();
    const found = await this.repository.find(id);
    if (!found) return this.notFound();
    await this.authorizeWorkspace(found.workspaceId, "WORKSPACE_VIEW", true, id);
    return found;
  }

  /** Trusted P2-009 read port. Caller must first authorize the linked Subject/Case. */
  async getForTargetProfile(
    workspaceId: string,
    entityId: string,
  ): Promise<Entity | null> {
    this.requireUser();
    const canonical = await this.resolve(workspaceId, entityId);
    if (!canonical) return null;
    const found = await this.repository.find(canonical.id);
    if (!found || found.workspaceId !== workspaceId || found.status !== "ACTIVE")
      return null;
    return found;
  }

  async list(workspaceId: string, limit = 50, cursor?: string) {
    this.requireUser();
    await this.authorizeWorkspace(workspaceId, "WORKSPACE_VIEW", true);
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
        !("workspaceId" in value) ||
        value.workspaceId !== workspaceId ||
        !("before" in value) ||
        typeof value.before !== "string" ||
        !isResourceId(value.before)
      )
        throw new AppError({
          code: "VALIDATION_INVALID_CURSOR",
          message: "Entity cursor is invalid.",
          statusCode: 400,
        });
      before = value.before;
    }
    const rows = await this.repository.list(workspaceId, limit + 1, before);
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      items,
      page: {
        hasMore,
        nextCursor: hasMore
          ? encodeCursor({ workspaceId, before: items.at(-1)!.id })
          : null,
      },
    };
  }

  async update(
    id: string,
    input: UpdateEntityInput,
    expectedRevision: number,
  ): Promise<Entity> {
    const actorUserId = this.requireUser();
    const changes = parseUpdateEntity(input);
    return this.transactions.run(async () => {
      const current = await this.repository.find(id);
      if (!current) return this.notFound();
      await this.authorizeWorkspace(
        current.workspaceId,
        "WORKSPACE_MANAGE",
        true,
        current.id,
      );
      assertExpectedRevision(expectedRevision, current.revision);
      return this.repository.update(current, changes, actorUserId);
    });
  }

  async merge(
    survivorEntityId: string,
    input: MergeEntityInput,
    survivorRevision: number,
    idempotencyKey: string,
    operationId: string,
  ): Promise<EntityMergeDecision> {
    const actorUserId = this.requireUser();
    const command = parseMergeEntity(input);
    parseIdempotencyKey(idempotencyKey, { required: true });
    if (!isResourceId(operationId))
      throw new AppError({
        code: "VALIDATION_ENTITY_INVALID",
        message: "Entity merge input is invalid.",
        statusCode: 400,
      });
    return this.transactions.run(async () => {
      const survivor = await this.repository.find(survivorEntityId);
      const absorbed = await this.repository.find(command.absorbedEntityId);
      if (!survivor || !absorbed || survivor.workspaceId !== absorbed.workspaceId)
        return this.notFound();
      await this.authorizeWorkspace(
        survivor.workspaceId,
        "WORKSPACE_MANAGE",
        true,
        survivor.id,
      );
      await this.authorizeWorkspace(
        absorbed.workspaceId,
        "WORKSPACE_MANAGE",
        true,
        absorbed.id,
      );
      const requestHash = digest({
        survivorEntityId,
        absorbedEntityId: command.absorbedEntityId,
        survivorRevision,
        absorbedRevision: command.absorbedRevision,
        reasonCode: command.reasonCode,
        operationId,
      });
      const merged = await this.repository.merge({
        workspaceId: survivor.workspaceId,
        survivorEntityId,
        absorbedEntityId: command.absorbedEntityId,
        survivorRevision,
        absorbedRevision: command.absorbedRevision,
        reasonCode: command.reasonCode,
        actorUserId,
        idempotencyKey,
        requestHash,
        operationId,
      });
      await this.audit.record({
        operationId,
        action: "ENTITY_MERGE",
        outcome: "AUTHORIZED",
        resource: {
          type: "ENTITY",
          id: command.absorbedEntityId,
          workspaceId: survivor.workspaceId,
        },
        reason: command.reasonCode,
        classification: "INTERNAL",
        resourceRevision: merged.decision.absorbedRevision,
      });
      return merged.decision;
    });
  }

  async reverseMerge(
    mergeId: string,
    input: ReverseEntityMergeInput,
    idempotencyKey: string,
    operationId: string,
  ): Promise<EntityMergeReversalDecision> {
    const actorUserId = this.requireUser();
    const command = parseReverseEntityMerge(input);
    parseIdempotencyKey(idempotencyKey, { required: true });
    if (!isResourceId(operationId))
      throw new AppError({
        code: "VALIDATION_ENTITY_INVALID",
        message: "Entity merge reversal input is invalid.",
        statusCode: 400,
      });
    return this.transactions.run(async () => {
      const merge = await this.repository.findMerge(mergeId);
      if (!merge) return this.mergeNotFound();
      const survivor = await this.repository.find(merge.survivorEntityId);
      const absorbed = await this.repository.find(merge.absorbedEntityId);
      if (!survivor || !absorbed) return this.mergeNotFound();
      await this.authorizeWorkspace(
        merge.workspaceId,
        "WORKSPACE_MANAGE",
        true,
        survivor.id,
      );
      await this.authorizeWorkspace(
        merge.workspaceId,
        "WORKSPACE_MANAGE",
        true,
        absorbed.id,
      );
      const requestHash = digest({
        mergeId,
        survivorRevision: command.survivorRevision,
        absorbedRevision: command.absorbedRevision,
        reasonCode: command.reasonCode,
        operationId,
      });
      const reversed = await this.repository.reverseMerge({
        mergeId,
        workspaceId: merge.workspaceId,
        survivorRevision: command.survivorRevision,
        absorbedRevision: command.absorbedRevision,
        reasonCode: command.reasonCode,
        actorUserId,
        idempotencyKey,
        requestHash,
        operationId,
      });
      await this.audit.record({
        operationId,
        action: "ENTITY_MERGE_REVERSE",
        outcome: "AUTHORIZED",
        resource: {
          type: "ENTITY",
          id: merge.absorbedEntityId,
          workspaceId: merge.workspaceId,
        },
        reason: command.reasonCode,
        classification: "INTERNAL",
        resourceRevision: reversed.decision.restoredEntityRevision,
      });
      return reversed.decision;
    });
  }

  /** Trusted resolution port. Merge-chain mutation is restricted to merge(). */
  async resolve(workspaceId: string, entityId: string) {
    return (await this.resolveMany(workspaceId, [entityId])).get(entityId) ?? null;
  }

  /** Resolution writes lock every visited merge-chain Entity until commit. */
  async resolveForResolution(workspaceId: string, entityId: string) {
    return (
      (await this.resolveManyInternal(workspaceId, [entityId], true)).get(entityId) ??
      null
    );
  }

  /** Bounded batch resolver prevents match-page reads from becoming N+1 queries. */
  async resolveMany(workspaceId: string, entityIds: readonly string[]) {
    return this.resolveManyInternal(workspaceId, entityIds, false);
  }

  private async resolveManyInternal(
    workspaceId: string,
    entityIds: readonly string[],
    forUpdate: boolean,
  ) {
    const states = new Map(
      [...new Set(entityIds)]
        .slice(0, 100)
        .map((requestedId) => [
          requestedId,
          { currentId: requestedId, visited: new Set<string>() },
        ]),
    );
    const resolved = new Map<
      string,
      {
        id: string;
        workspaceId: string;
        type: Entity["type"];
        status: "ACTIVE";
        revision: number;
      }
    >();
    for (let depth = 0; depth < 16; depth += 1) {
      const pending = [...states.entries()].filter(([id]) => !resolved.has(id));
      if (pending.length === 0) break;
      const requestedIds = pending.map(([, state]) => state.currentId);
      const entities = new Map(
        (
          await (forUpdate
            ? this.repository.findManyForUpdate(requestedIds)
            : this.repository.findMany(requestedIds))
        ).map((entity) => [entity.id, entity]),
      );
      for (const [requestedId, state] of pending) {
        if (state.visited.has(state.currentId)) {
          states.delete(requestedId);
          continue;
        }
        state.visited.add(state.currentId);
        const entity = entities.get(state.currentId);
        if (!entity || entity.workspaceId !== workspaceId) {
          states.delete(requestedId);
          continue;
        }
        if (entity.status === "ACTIVE") {
          resolved.set(requestedId, {
            id: entity.id,
            workspaceId: entity.workspaceId,
            type: entity.type,
            status: "ACTIVE" as const,
            revision: entity.revision,
          });
          continue;
        }
        if (entity.status !== "MERGED" || !entity.mergedInto) {
          states.delete(requestedId);
          continue;
        }
        state.currentId = entity.mergedInto.id;
      }
    }
    return resolved;
  }

  private async authorizeWorkspace(
    workspaceId: string,
    action: "WORKSPACE_VIEW" | "WORKSPACE_MANAGE",
    hideExistence: boolean,
    entityId?: string,
  ): Promise<void> {
    try {
      await this.workspaces.get(workspaceId);
    } catch (error) {
      if (hideExistence && error instanceof AppError && error.statusCode === 404)
        return this.notFound();
      throw error;
    }
    await this.policy.enforce(
      {
        action,
        resource: {
          type: entityId ? "ENTITY" : "WORKSPACE",
          id: entityId ?? workspaceId,
          workspaceId,
        },
      },
      hideExistence
        ? {
            hideExistence: true,
            notFoundCode: "ENTITY_NOT_FOUND",
            notFoundMessage: "Entity was not found.",
          }
        : {},
    );
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
      code: "ENTITY_NOT_FOUND",
      message: "Entity was not found.",
      statusCode: 404,
    });
  }

  private mergeNotFound(): never {
    throw new AppError({
      code: "ENTITY_MERGE_NOT_FOUND",
      message: "Entity merge was not found.",
      statusCode: 404,
    });
  }
}

function digest(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

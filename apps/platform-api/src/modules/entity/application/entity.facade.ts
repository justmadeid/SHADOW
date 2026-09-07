import { Inject, Injectable } from "@nestjs/common";
import { DrizzleTransactionManager } from "@intelligence/database";
import { isResourceId } from "@intelligence/contracts";
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
  type UpdateEntityInput,
} from "../domain/entity.js";
import { parseUpdateEntity } from "../domain/entity-input.js";

@Injectable()
export class EntityFacade {
  constructor(
    @Inject(ENTITY_REPOSITORY) private readonly repository: EntityRepository,
    @Inject(WorkspaceFacade) private readonly workspaces: WorkspaceFacade,
    @Inject(PolicyEnforcer) private readonly policy: PolicyEnforcer,
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

  async get(id: string): Promise<Entity> {
    this.requireUser();
    const found = await this.repository.find(id);
    if (!found) return this.notFound();
    await this.authorizeWorkspace(found.workspaceId, "WORKSPACE_VIEW", true, id);
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

  /** Trusted resolution port. Merged-chain creation is deferred to P2-011. */
  async resolve(workspaceId: string, entityId: string) {
    let id = entityId;
    const visited = new Set<string>();
    for (let depth = 0; depth < 16; depth += 1) {
      if (visited.has(id)) return null;
      visited.add(id);
      const entity = await this.repository.find(id);
      if (!entity || entity.workspaceId !== workspaceId) return null;
      if (entity.status === "ACTIVE")
        return {
          id: entity.id,
          workspaceId: entity.workspaceId,
          type: entity.type,
          status: "ACTIVE" as const,
          revision: entity.revision,
        };
      if (entity.status !== "MERGED" || !entity.mergedInto) return null;
      id = entity.mergedInto.id;
    }
    return null;
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
}

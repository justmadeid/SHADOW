import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";

import { DrizzleTransactionManager } from "@intelligence/database";
import { isResourceId } from "@intelligence/contracts";
import { CaseFacade } from "../../case/index.js";
import { NodeInstanceFacade } from "../../workflow/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import { decodeCursor, encodeCursor } from "../../../platform/http/cursor.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { RUN_REPOSITORY, type RunRepository } from "../domain/run-repository.js";
import { assertCancellable, assertRetryable, type Run } from "../domain/run.js";

@Injectable()
export class RunFacade {
  constructor(
    @Inject(RUN_REPOSITORY) private readonly repository: RunRepository,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(RequestContextStore) private readonly context: RequestContextStore,
    @Inject(CaseFacade) private readonly cases: CaseFacade,
    @Inject(NodeInstanceFacade) private readonly nodeInstances: NodeInstanceFacade,
  ) {}

  async create(nodeInstanceId: string, idempotencyKey: string): Promise<Run> {
    const actorUserId = this.requireUser();
    const node = await this.nodeInstances.get(nodeInstanceId);
    return this.cases.withAccess(node.caseId, "RUN_CREATE", async (parent) => {
      const current = await this.nodeInstances.get(nodeInstanceId);
      if (current.workspaceId !== parent.workspaceId) return this.nodeInstanceNotFound();
      this.assertReady(current.status);

      const bindings = await this.nodeInstances.listInputBindings(nodeInstanceId);
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ nodeInstanceId }))
        .digest("hex");

      const result = await this.transactions.run(() =>
        this.repository.create({
          workspaceId: parent.workspaceId,
          caseId: parent.id,
          investigationId: current.investigationId,
          nodeInstanceId,
          nodeDefinitionKey: current.nodeDefinitionKey,
          nodeDefinitionVersion: current.nodeDefinitionVersion,
          inputSnapshot: {
            configuration: current.configuration,
            inputBindings: bindings,
          },
          trigger: "MANUAL",
          triggeredByUserId: actorUserId,
          idempotencyKey,
          requestHash,
        }),
      );
      return result.run;
    });
  }

  async get(id: string): Promise<Run> {
    this.requireUser();
    const found = await this.repository.find(id);
    if (!found) return this.notFound();
    try {
      const parent = await this.cases.get(found.caseId, "RUN_VIEW");
      if (parent.workspaceId !== found.workspaceId) return this.notFound();
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) return this.notFound();
      throw error;
    }
    return found;
  }

  async list(caseId: string, limit = 50, cursor?: string) {
    this.requireUser();
    const parent = await this.cases.get(caseId, "RUN_VIEW");
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
        !("caseId" in value) ||
        value.caseId !== caseId ||
        !("workspaceId" in value) ||
        value.workspaceId !== parent.workspaceId ||
        !("before" in value) ||
        typeof value.before !== "string" ||
        !isResourceId(value.before)
      )
        throw new AppError({
          code: "VALIDATION_INVALID_CURSOR",
          message: "Run cursor is invalid.",
          statusCode: 400,
        });
      before = value.before;
    }
    const rows = await this.repository.listByCase(
      parent.workspaceId,
      caseId,
      limit + 1,
      before,
    );
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      items,
      page: {
        hasMore,
        nextCursor: hasMore
          ? encodeCursor({
              caseId,
              workspaceId: parent.workspaceId,
              before: items.at(-1)!.id,
            })
          : null,
      },
    };
  }

  async cancel(id: string, expectedRevision: number): Promise<Run> {
    const actorUserId = this.requireUser();
    const found = await this.get(id);
    return this.cases.withAccess(found.caseId, "RUN_CANCEL", async () => {
      const current = await this.requireCurrent(id);
      assertExpectedRevision(expectedRevision, current.revision);
      assertCancellable(current);
      return this.repository.cancel({ runId: id, expectedRevision, actorUserId });
    });
  }

  async retry(
    id: string,
    expectedRevision: number,
    idempotencyKey: string,
  ): Promise<Run> {
    const actorUserId = this.requireUser();
    const original = await this.get(id);
    return this.cases.withAccess(original.caseId, "RUN_CREATE", async (parent) => {
      const currentOriginal = await this.requireCurrent(id);
      assertExpectedRevision(expectedRevision, currentOriginal.revision);
      assertRetryable(currentOriginal);

      const node = await this.nodeInstances.get(currentOriginal.nodeInstanceId);
      if (node.workspaceId !== parent.workspaceId) return this.nodeInstanceNotFound();
      this.assertReady(node.status);
      const bindings = await this.nodeInstances.listInputBindings(node.id);

      const requestHash = createHash("sha256")
        .update(JSON.stringify({ retryOf: currentOriginal.id }))
        .digest("hex");

      const result = await this.transactions.run(() =>
        this.repository.create({
          workspaceId: parent.workspaceId,
          caseId: parent.id,
          investigationId: node.investigationId,
          nodeInstanceId: node.id,
          nodeDefinitionKey: node.nodeDefinitionKey,
          nodeDefinitionVersion: node.nodeDefinitionVersion,
          inputSnapshot: { configuration: node.configuration, inputBindings: bindings },
          trigger: "MANUAL",
          triggeredByUserId: actorUserId,
          retryOf: currentOriginal.id,
          idempotencyKey,
          requestHash,
        }),
      );
      return result.run;
    });
  }

  private assertReady(status: string): void {
    if (status !== "READY")
      throw new AppError({
        code: "RUN_NODE_INSTANCE_NOT_READY",
        message: "The NodeInstance must be READY before a Run can be created.",
        statusCode: 409,
      });
  }

  private async requireCurrent(id: string): Promise<Run> {
    const current = await this.repository.find(id);
    if (!current) return this.notFound();
    return current;
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
      code: "RUN_NOT_FOUND",
      message: "Run was not found.",
      statusCode: 404,
    });
  }

  private nodeInstanceNotFound(): never {
    throw new AppError({
      code: "NODE_INSTANCE_NOT_FOUND",
      message: "NodeInstance was not found.",
      statusCode: 404,
    });
  }
}

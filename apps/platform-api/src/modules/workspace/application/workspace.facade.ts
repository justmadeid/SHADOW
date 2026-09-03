import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";

import { DrizzleTransactionManager } from "@intelligence/database";
import { AppError } from "../../../platform/errors/index.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import type { WorkspaceRepository } from "../domain/workspace-repository.js";
import {
  type CreateWorkspaceInput,
  type Workspace,
  validateCreateWorkspaceInput,
} from "../domain/workspace.js";
import { WORKSPACE_REPOSITORY } from "../workspace.tokens.js";

@Injectable()
export class WorkspaceFacade {
  constructor(
    @Inject(WORKSPACE_REPOSITORY)
    private readonly repository: WorkspaceRepository,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(RequestContextStore)
    private readonly requestContext: RequestContextStore,
  ) {}

  async create(input: CreateWorkspaceInput, idempotencyKey: string): Promise<Workspace> {
    const userId = this.requireUserId();
    const normalized = validateCreateWorkspaceInput(input);
    const requestHash = createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");

    const result = await this.transactions.run(() =>
      this.repository.createForUser({
        ...normalized,
        userId,
        idempotencyKey,
        requestHash,
      }),
    );

    return result.workspace;
  }

  async list(): Promise<Workspace[]> {
    return this.repository.listForUser(this.requireUserId(), 100);
  }

  async get(workspaceId: string): Promise<Workspace> {
    const workspace = await this.repository.findByIdForUser(
      workspaceId,
      this.requireUserId(),
    );

    if (!workspace) {
      throw new AppError({
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace was not found.",
        statusCode: 404,
      });
    }

    return workspace;
  }

  private requireUserId(): string {
    const principal = this.requestContext.get().principal;
    if (!principal || principal.kind !== "USER") {
      throw new AppError({
        code: "AUTH_USER_REQUIRED",
        message: "This operation requires an authenticated user.",
        statusCode: 403,
      });
    }
    return principal.userId;
  }
}

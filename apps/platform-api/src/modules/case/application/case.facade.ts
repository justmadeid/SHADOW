import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";

import { DrizzleTransactionManager } from "@intelligence/database";
import { WorkspaceFacade } from "../../workspace/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import type { CaseRepository } from "../domain/case-repository.js";
import {
  assertCaseMutable,
  type Case,
  type CaseAction,
  type CreateCaseInput,
  nextCaseStatus,
  type UpdateCaseInput,
  validateCreateCaseInput,
  validateUpdateCaseInput,
} from "../domain/case.js";
import { CASE_REPOSITORY } from "../case.tokens.js";

@Injectable()
export class CaseFacade {
  constructor(
    @Inject(CASE_REPOSITORY)
    private readonly repository: CaseRepository,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(RequestContextStore)
    private readonly requestContext: RequestContextStore,
    @Inject(WorkspaceFacade)
    private readonly workspaces: WorkspaceFacade,
  ) {}

  async create(input: CreateCaseInput, idempotencyKey: string): Promise<Case> {
    const actorUserId = this.requireUserId();
    const normalized = validateCreateCaseInput(input);
    await this.workspaces.get(normalized.workspaceId);

    const requestHash = createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");

    const result = await this.transactions.run(() =>
      this.repository.create({
        ...normalized,
        actorUserId,
        idempotencyKey,
        requestHash,
      }),
    );

    return result.case;
  }

  async list(workspaceId: string): Promise<Case[]> {
    this.requireUserId();
    await this.workspaces.get(workspaceId);
    return this.repository.listByWorkspace(workspaceId, 100);
  }

  async get(caseId: string): Promise<Case> {
    this.requireUserId();
    const found = await this.repository.findById(caseId);
    if (!found) {
      return this.caseNotFound();
    }

    try {
      await this.workspaces.get(found.workspaceId);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        return this.caseNotFound();
      }
      throw error;
    }

    return found;
  }

  async update(
    caseId: string,
    input: UpdateCaseInput,
    expectedRevision: number,
  ): Promise<Case> {
    const actorUserId = this.requireUserId();
    const current = await this.get(caseId);
    assertExpectedRevision(expectedRevision, current.revision);
    assertCaseMutable(current.status);
    const changes = validateUpdateCaseInput(input);

    return this.transactions.run(() =>
      this.repository.update({ caseId, expectedRevision, actorUserId, changes }),
    );
  }

  async transition(
    caseId: string,
    action: CaseAction,
    expectedRevision: number,
  ): Promise<Case> {
    const actorUserId = this.requireUserId();
    const current = await this.get(caseId);
    assertExpectedRevision(expectedRevision, current.revision);
    const toStatus = nextCaseStatus(current.status, action);

    return this.transactions.run(() =>
      this.repository.transition({
        caseId,
        expectedRevision,
        actorUserId,
        fromStatus: current.status,
        toStatus,
      }),
    );
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

  private caseNotFound(): never {
    throw new AppError({
      code: "CASE_NOT_FOUND",
      message: "Case was not found.",
      statusCode: 404,
    });
  }
}

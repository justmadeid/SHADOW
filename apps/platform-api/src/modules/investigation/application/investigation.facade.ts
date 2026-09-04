import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";

import { DrizzleTransactionManager } from "@intelligence/database";
import { CaseFacade, type Case } from "../../case/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { INVESTIGATION_REPOSITORY } from "../investigation.tokens.js";
import type { InvestigationRepository } from "../domain/investigation-repository.js";
import {
  assertInvestigationUpdateAllowed,
  type CreateInvestigationInput,
  type Investigation,
  type UpdateInvestigationInput,
  validateCreateInvestigationInput,
  validateUpdateInvestigationInput,
} from "../domain/investigation.js";

@Injectable()
export class InvestigationFacade {
  constructor(
    @Inject(INVESTIGATION_REPOSITORY)
    private readonly repository: InvestigationRepository,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(RequestContextStore)
    private readonly requestContext: RequestContextStore,
    @Inject(CaseFacade)
    private readonly cases: CaseFacade,
  ) {}

  async create(
    caseId: string,
    input: CreateInvestigationInput,
    idempotencyKey: string,
  ): Promise<Investigation> {
    const actorUserId = this.requireUserId();
    return this.cases.withAccess(caseId, "INVESTIGATION_CREATE", async (parent) => {
      this.assertParentMutable(parent);
      const normalized = validateCreateInvestigationInput(input);
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ caseId, ...normalized }))
        .digest("hex");

      const result = await this.transactions.run(() =>
        this.repository.create({
          ...normalized,
          workspaceId: parent.workspaceId,
          caseId,
          actorUserId,
          idempotencyKey,
          requestHash,
        }),
      );
      return result.investigation;
    });
  }

  async list(caseId: string): Promise<Investigation[]> {
    this.requireUserId();
    const parent = await this.cases.get(caseId, "INVESTIGATION_VIEW");
    return this.repository.listByCase(parent.workspaceId, caseId, 100);
  }

  async get(investigationId: string): Promise<Investigation> {
    this.requireUserId();
    const found = await this.repository.findById(investigationId);
    if (!found) return this.notFound();

    try {
      const parent = await this.cases.get(found.caseId, "INVESTIGATION_VIEW");
      if (parent.workspaceId !== found.workspaceId) return this.notFound();
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) return this.notFound();
      throw error;
    }
    return found;
  }

  async update(
    investigationId: string,
    input: UpdateInvestigationInput,
    expectedRevision: number,
  ): Promise<Investigation> {
    this.requireUserId();
    const found = await this.get(investigationId);
    return this.cases.withAccess(found.caseId, "INVESTIGATION_UPDATE", async () => {
      const current = await this.get(investigationId);
      assertExpectedRevision(expectedRevision, current.revision);
      const changes = validateUpdateInvestigationInput(input);
      assertInvestigationUpdateAllowed(current.status, changes.status);

      return this.transactions.run(() =>
        this.repository.update({
          investigationId,
          workspaceId: current.workspaceId,
          caseId: current.caseId,
          expectedRevision,
          changes,
        }),
      );
    });
  }

  private assertParentMutable(parent: Case): void {
    if (parent.status === "CLOSED" || parent.status === "ARCHIVED") {
      throw new AppError({
        code: "INVESTIGATION_PARENT_CASE_NOT_MUTABLE",
        message: "An Investigation cannot be created in a closed or archived Case.",
        statusCode: 409,
      });
    }
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

  private notFound(): never {
    throw new AppError({
      code: "INVESTIGATION_NOT_FOUND",
      message: "Investigation was not found.",
      statusCode: 404,
    });
  }
}

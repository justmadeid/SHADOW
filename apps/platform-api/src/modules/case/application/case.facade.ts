import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";

import { DrizzleTransactionManager } from "@intelligence/database";
import { WorkspaceFacade } from "../../workspace/index.js";
import {
  CaseMembershipFacade,
  PolicyEnforcer,
  type CaseRole,
  type Permission,
} from "../../governance/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/http/cursor.js";
import { assertUuid } from "../../../platform/ids/uuid.js";
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
    @Inject(PolicyEnforcer) private readonly policy: PolicyEnforcer,
    @Inject(CaseMembershipFacade) private readonly memberships: CaseMembershipFacade,
  ) {}

  async create(input: CreateCaseInput, idempotencyKey: string): Promise<Case> {
    const actorUserId = this.requireUserId();
    const normalized = validateCreateCaseInput(input);
    await this.workspaces.get(normalized.workspaceId);

    const requestHash = createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");

    return this.transactions.run(async () => {
      const result = await this.repository.create({
        ...normalized,
        actorUserId,
        idempotencyKey,
        requestHash,
      });
      if (!result.replayed) {
        await this.memberships.initializeNewCase(result.case.workspaceId, result.case.id);
      }
      // Replays must reauthorize, never restore a removed creator's membership.
      return this.get(result.case.id);
    });
  }

  async list(workspaceId: string): Promise<Case[]> {
    return (await this.listPage(workspaceId)).items;
  }

  async access(caseId: string) {
    return this.transactions.run(async () => {
      const found = await this.get(caseId);
      await this.memberships.lockCase(found.workspaceId, found.id);
      await this.get(caseId);
      const permissions = [
        "CASE_UPDATE",
        "INVESTIGATION_CREATE",
        "GOVERNANCE_ROLE_MANAGE",
      ] as const;
      const decisions = await Promise.all(
        permissions.map((action) =>
          this.policy.decide({
            action,
            resource: { type: "CASE", id: found.id, workspaceId: found.workspaceId },
            context: { caseId: found.id, caseMembershipRequired: true },
          }),
        ),
      );
      return {
        caseId: found.id,
        workspaceId: found.workspaceId,
        permissions: {
          view: true,
          update: decisions[0]!.allowed,
          createInvestigation: decisions[1]!.allowed,
          manageMembers: decisions[2]!.allowed,
        },
      };
    });
  }

  async listPage(workspaceId: string, cursor?: string) {
    this.requireUserId();
    await this.workspaces.get(workspaceId);
    let before: string | undefined;
    if (cursor !== undefined) {
      const payload = decodeCursor<unknown>(cursor);
      if (
        !payload ||
        typeof payload !== "object" ||
        !("workspaceId" in payload) ||
        payload.workspaceId !== workspaceId ||
        !("before" in payload) ||
        typeof payload.before !== "string"
      ) {
        throw new AppError({
          code: "VALIDATION_INVALID_CURSOR",
          message: "The Case cursor is invalid.",
          statusCode: 400,
        });
      }
      try {
        before = assertUuid(payload.before);
      } catch {
        throw new AppError({
          code: "VALIDATION_INVALID_CURSOR",
          message: "The Case cursor is invalid.",
          statusCode: 400,
        });
      }
    }
    const ids = await this.memberships.listCaseIds(workspaceId, before);
    const selected = ids.slice(0, 100);
    return {
      items: await this.repository.listByWorkspace(workspaceId, 100, selected),
      page: {
        hasMore: ids.length > 100,
        nextCursor:
          ids.length > 100
            ? encodeCursor({ workspaceId, before: selected.at(-1)! })
            : null,
      },
    };
  }

  async get(caseId: string, action: Permission = "CASE_VIEW"): Promise<Case> {
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

    await this.enforceCase(found, "CASE_VIEW");
    if (action !== "CASE_VIEW") await this.enforceCase(found, action);
    return found;
  }

  async update(
    caseId: string,
    input: UpdateCaseInput,
    expectedRevision: number,
  ): Promise<Case> {
    const actorUserId = this.requireUserId();
    return this.withAccess(caseId, "CASE_UPDATE", async (current) => {
      assertExpectedRevision(expectedRevision, current.revision);
      assertCaseMutable(current.status);
      const changes = validateUpdateCaseInput(input);

      return this.repository.update({ caseId, expectedRevision, actorUserId, changes });
    });
  }

  async transition(
    caseId: string,
    action: CaseAction,
    expectedRevision: number,
  ): Promise<Case> {
    const actorUserId = this.requireUserId();
    return this.withAccess(caseId, "CASE_UPDATE", async (current) => {
      assertExpectedRevision(expectedRevision, current.revision);
      const toStatus = nextCaseStatus(current.status, action);

      return this.repository.transition({
        caseId,
        expectedRevision,
        actorUserId,
        fromStatus: current.status,
        toStatus,
      });
    });
  }

  async withAccess<T>(
    caseId: string,
    action: Permission,
    work: (parent: Case) => Promise<T>,
  ): Promise<T> {
    this.requireUserId();
    return this.transactions.run(async () => {
      const found = await this.repository.findById(caseId);
      if (!found) return this.caseNotFound();
      await this.memberships.lockCase(found.workspaceId, found.id);
      const current = await this.get(caseId, action);
      return work(current);
    });
  }

  async addMember(caseId: string, userId: string, role: CaseRole, reason: string) {
    return this.withAccess(caseId, "GOVERNANCE_ROLE_MANAGE", async (parent) => {
      if (!(await this.workspaces.hasMember(parent.workspaceId, userId)))
        throw new AppError({
          code: "CASE_MEMBER_NOT_ELIGIBLE",
          message: "The user is not an active Workspace member.",
          statusCode: 400,
        });
      return this.memberships.add(parent.workspaceId, parent.id, userId, role, reason);
    });
  }

  async removeMember(
    caseId: string,
    membershipId: string,
    expectedRevision: number,
    reason: string,
  ) {
    return this.withAccess(caseId, "GOVERNANCE_ROLE_MANAGE", (parent) =>
      this.memberships.remove(
        parent.workspaceId,
        parent.id,
        membershipId,
        expectedRevision,
        reason,
      ),
    );
  }

  private enforceCase(value: Case, action: Permission) {
    return this.policy.enforce(
      {
        action,
        resource: { type: "CASE", id: value.id, workspaceId: value.workspaceId },
        context: { caseId: value.id, caseMembershipRequired: true },
      },
      {
        hideExistence: true,
        notFoundCode: "CASE_NOT_FOUND",
        notFoundMessage: "Case was not found.",
      },
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

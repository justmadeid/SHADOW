import { Inject, Injectable } from "@nestjs/common";
import { currentTransaction } from "@intelligence/database";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { CASE_MEMBERSHIP_STORE } from "../governance.tokens.js";
import {
  type CaseMembershipStore,
  type CaseRole,
  validateMembershipInput,
} from "../domain/case-membership.js";
import { PolicyEnforcer } from "./policy-enforcer.js";

@Injectable()
export class CaseMembershipFacade {
  constructor(
    @Inject(CASE_MEMBERSHIP_STORE) private readonly store: CaseMembershipStore,
    @Inject(PolicyEnforcer) private readonly policy: PolicyEnforcer,
    @Inject(RequestContextStore) private readonly context: RequestContextStore,
  ) {}

  // Trusted Case creation hook only. Never expose as an HTTP/admin command.
  // The Case domain calls this exactly once on new creation, never on replay.
  async initializeNewCase(workspaceId: string, caseId: string) {
    this.requireTransaction();
    return this.store.grant(
      workspaceId,
      caseId,
      this.userId(),
      "OWNER",
      this.userId(),
      "CASE_CREATED",
    );
  }

  async lockCase(workspaceId: string, caseId: string): Promise<void> {
    this.requireTransaction();
    await this.store.lockCase(workspaceId, caseId);
  }

  async add(
    workspaceId: string,
    caseId: string,
    userId: string,
    role: CaseRole,
    reason: string,
  ) {
    this.requireTransaction();
    await this.lockCase(workspaceId, caseId);
    await this.enforceManage(workspaceId, caseId);
    validateMembershipInput(userId, role, reason);
    return this.store.grant(
      workspaceId,
      caseId,
      userId,
      role,
      this.userId(),
      reason.trim(),
    );
  }

  async remove(
    workspaceId: string,
    caseId: string,
    membershipId: string,
    expectedRevision: number,
    reason: string,
  ) {
    this.requireTransaction();
    await this.lockCase(workspaceId, caseId);
    await this.enforceManage(workspaceId, caseId);
    validateMembershipInput(this.userId(), "OWNER", reason);
    return this.store.revoke(
      workspaceId,
      caseId,
      membershipId,
      expectedRevision,
      this.userId(),
      reason.trim(),
    );
  }

  listCaseIds(workspaceId: string, before?: string): Promise<string[]> {
    return this.store.listCaseIds(workspaceId, this.userId(), before);
  }

  private enforceManage(workspaceId: string, caseId: string) {
    return this.policy.enforce(
      {
        action: "GOVERNANCE_ROLE_MANAGE",
        resource: { type: "CASE", id: caseId, workspaceId },
        context: { caseId, caseMembershipRequired: true },
      },
      {
        hideExistence: true,
        notFoundCode: "CASE_NOT_FOUND",
        notFoundMessage: "Case was not found.",
      },
    );
  }

  private userId(): string {
    const principal = this.context.get().principal;
    if (principal?.kind !== "USER")
      throw new AppError({
        code: "AUTH_USER_REQUIRED",
        message: "This operation requires an authenticated user.",
        statusCode: 403,
      });
    return principal.userId;
  }

  private requireTransaction(): void {
    if (!currentTransaction())
      throw new Error("Case membership writes require the caller's domain transaction.");
  }
}

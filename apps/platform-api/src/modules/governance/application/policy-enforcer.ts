import { Inject, Injectable } from "@nestjs/common";

import { AppError } from "../../../platform/errors/index.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import type { GovernanceRepository } from "../domain/governance-repository.js";
import {
  permissionRequiresReason,
  scopeMatches,
  type GovernanceSubjectType,
  type GovernanceAction,
  type PolicyContext,
  type PolicyDecision,
  type PolicyRequest,
  type PolicyResource,
} from "../domain/governance.js";
import { GOVERNANCE_REPOSITORY } from "../governance.tokens.js";

export type EnforceOptions = {
  hideExistence?: boolean;
  notFoundCode?: string;
  notFoundMessage?: string;
};

@Injectable()
export class PolicyEnforcer {
  constructor(
    @Inject(GOVERNANCE_REPOSITORY)
    private readonly repository: GovernanceRepository,
    @Inject(RequestContextStore)
    private readonly requestContext: RequestContextStore,
  ) {}

  async decide(request: PolicyRequest): Promise<PolicyDecision> {
    const principal = this.requestContext.get().principal;
    if (!principal) return this.deny(request, "DENY_UNAUTHENTICATED");

    const subjectType: GovernanceSubjectType = principal.kind;
    const subjectId = principal.kind === "USER" ? principal.userId : principal.serviceId;
    const grants = await this.repository.findPermissionGrants({
      workspaceId: request.resource.workspaceId,
      subjectType,
      subjectId,
      permission: request.action,
    });

    if (grants.length === 0) {
      return this.deny(request, "DENY_PERMISSION_MISSING");
    }

    const matching = grants.filter(
      (grant) =>
        scopeMatches(grant.scope, request.resource, request.context) &&
        (!request.context?.caseMembershipRequired ||
          (grant.caseMembership === true && grant.scope.type === "CASE")),
    );
    if (matching.length === 0) {
      return this.deny(request, "DENY_SCOPE_MISMATCH");
    }

    if (
      permissionRequiresReason(request.action) &&
      !request.context?.reasonForAccess?.trim()
    ) {
      return this.deny(request, "DENY_REASON_REQUIRED");
    }

    return {
      allowed: true,
      code: "ALLOW_ROLE_GRANT",
      action: request.action,
      resource: request.resource,
      matchedRoleIds: [...new Set(matching.map((grant) => grant.roleId))].sort(),
    };
  }

  async enforce(
    request: PolicyRequest,
    options: EnforceOptions = {},
  ): Promise<PolicyDecision> {
    const decision = await this.decide(request);
    if (decision.allowed) return decision;

    if (options.hideExistence) {
      throw new AppError({
        code: options.notFoundCode ?? "RESOURCE_NOT_FOUND",
        message: options.notFoundMessage ?? "Resource was not found.",
        statusCode: 404,
      });
    }

    throw new AppError({
      code: "ACCESS_DENIED",
      message: "The authenticated principal is not allowed to perform this action.",
      statusCode: 403,
      details: { decision: decision.code, action: decision.action },
    });
  }

  private deny(
    request: PolicyRequest,
    code: Exclude<PolicyDecision["code"], "ALLOW_ROLE_GRANT">,
  ): PolicyDecision {
    return {
      allowed: false,
      code,
      action: request.action,
      resource: request.resource,
      matchedRoleIds: [],
    };
  }

  async authorize(
    action: GovernanceAction,
    resource: PolicyResource,
    context: PolicyContext = {},
  ): Promise<PolicyDecision> {
    return this.decide({ action, resource, context });
  }
}

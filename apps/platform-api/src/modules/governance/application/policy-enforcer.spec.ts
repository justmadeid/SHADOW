import { describe, expect, it } from "vitest";

import type { GovernanceRepository } from "../domain/governance-repository.js";
import type {
  GovernanceScope,
  Permission,
  PermissionGrant,
  PolicyRequest,
} from "../domain/governance.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { PolicyEnforcer } from "./policy-enforcer.js";

describe("PolicyEnforcer", () => {
  const workspaceId = "01992028-0000-7000-8000-000000000001";
  const caseA = "01992028-0000-7000-8000-000000000002";
  const caseB = "01992028-0000-7000-8000-000000000003";

  it("denies by default when no active role grants the permission", async () => {
    const { enforcer, context } = setup([]);
    const decision = await runAsUser(context, "analyst-a", () =>
      enforcer.authorize(
        "CASE_VIEW",
        request("CASE_VIEW", caseA).resource,
        request("CASE_VIEW", caseA).context,
      ),
    );

    expect(decision).toMatchObject({
      allowed: false,
      code: "DENY_PERMISSION_MISSING",
      matchedRoleIds: [],
    });
  });

  it("allows a matching case-scoped user grant and rejects another case", async () => {
    const { enforcer, context } = setup([
      grant("role-case-reader", "CASE_VIEW", { type: "CASE", resourceId: caseA }),
    ]);

    await expect(
      runAsUser(context, "analyst-a", () => enforcer.decide(request("CASE_VIEW", caseA))),
    ).resolves.toMatchObject({
      allowed: true,
      code: "ALLOW_ROLE_GRANT",
      matchedRoleIds: ["role-case-reader"],
    });
    await expect(
      runAsUser(context, "analyst-a", () => enforcer.decide(request("CASE_VIEW", caseB))),
    ).resolves.toMatchObject({ allowed: false, code: "DENY_SCOPE_MISMATCH" });
  });

  it("evaluates service identities using their own assignments", async () => {
    const repository = new QueryAwareRepository([
      grant("role-worker", "INVESTIGATION_UPDATE", { type: "WORKSPACE" }),
    ]);
    const context = new RequestContextStore();
    const enforcer = new PolicyEnforcer(repository, context);

    const decision = await context.run(
      {
        requestId: "request-worker",
        traceId: "trace-worker",
        issuedAt: new Date().toISOString(),
        principal: {
          kind: "SERVICE",
          subject: "analysis-worker",
          serviceId: "analysis-worker",
          clientId: "analysis-worker",
          issuer: "https://identity.example.test",
        },
      },
      () => enforcer.decide(request("INVESTIGATION_UPDATE", caseA)),
    );

    expect(decision.allowed).toBe(true);
    expect(repository.lastQuery).toMatchObject({
      subjectType: "SERVICE",
      subjectId: "analysis-worker",
    });
  });

  it("requires reason-for-access for restricted use and view actions", async () => {
    const { enforcer, context } = setup([
      grant("role-restricted", "IDENTIFIER_USE_RESTRICTED", {
        type: "WORKSPACE",
      }),
    ]);
    const restrictedRequest: PolicyRequest = {
      action: "IDENTIFIER_USE_RESTRICTED",
      resource: { type: "IDENTIFIER", id: caseA, workspaceId },
    };

    await expect(
      runAsUser(context, "analyst-a", () => enforcer.decide(restrictedRequest)),
    ).resolves.toMatchObject({ allowed: false, code: "DENY_REASON_REQUIRED" });
    await expect(
      runAsUser(context, "analyst-a", () =>
        enforcer.decide({
          ...restrictedRequest,
          context: { reasonForAccess: "Validate supplied subject identifier" },
        }),
      ),
    ).resolves.toMatchObject({ allowed: true, code: "ALLOW_ROLE_GRANT" });
  });

  it("can conceal a denied resource with a confidentiality-safe 404", async () => {
    const { enforcer, context } = setup([]);

    await expect(
      runAsUser(context, "analyst-a", () =>
        enforcer.enforce(request("CASE_VIEW", caseA), {
          hideExistence: true,
          notFoundCode: "CASE_NOT_FOUND",
          notFoundMessage: "Case was not found.",
        }),
      ),
    ).rejects.toMatchObject({ code: "CASE_NOT_FOUND", statusCode: 404 });
  });

  it("does not query grants when authentication context has no principal", async () => {
    const repository = new QueryAwareRepository([]);
    const context = new RequestContextStore();
    const enforcer = new PolicyEnforcer(repository, context);
    const decision = await context.run(
      {
        requestId: "request-anonymous",
        traceId: "trace-anonymous",
        issuedAt: new Date().toISOString(),
      },
      () => enforcer.decide(request("CASE_VIEW", caseA)),
    );

    expect(decision).toMatchObject({
      allowed: false,
      code: "DENY_UNAUTHENTICATED",
    });
    expect(repository.lastQuery).toBeUndefined();
  });

  function setup(grants: PermissionGrant[]) {
    const context = new RequestContextStore();
    return {
      context,
      enforcer: new PolicyEnforcer(new QueryAwareRepository(grants), context),
    };
  }

  function request(permission: Permission, caseId: string): PolicyRequest {
    return {
      action: permission,
      resource: { type: "CASE", id: caseId, workspaceId },
      context: { caseId },
    };
  }
});

function grant(
  roleId: string,
  permission: Permission,
  scope: GovernanceScope,
): PermissionGrant {
  return { roleId, permission, scope };
}

class QueryAwareRepository implements GovernanceRepository {
  lastQuery?: Parameters<GovernanceRepository["findPermissionGrants"]>[0];

  constructor(private readonly grants: PermissionGrant[]) {}

  createRole(): ReturnType<GovernanceRepository["createRole"]> {
    throw new Error("Not used by PolicyEnforcer tests.");
  }

  createAssignment(): ReturnType<GovernanceRepository["createAssignment"]> {
    throw new Error("Not used by PolicyEnforcer tests.");
  }

  revokeAssignment(): ReturnType<GovernanceRepository["revokeAssignment"]> {
    throw new Error("Not used by PolicyEnforcer tests.");
  }

  async findPermissionGrants(
    query: Parameters<GovernanceRepository["findPermissionGrants"]>[0],
  ): Promise<PermissionGrant[]> {
    this.lastQuery = query;
    return this.grants.filter((grant) => grant.permission === query.permission);
  }
}

function runAsUser<T>(
  context: RequestContextStore,
  userId: string,
  work: () => Promise<T>,
): Promise<T> {
  return context.run(
    {
      requestId: `request-${userId}`,
      traceId: `trace-${userId}`,
      issuedAt: new Date().toISOString(),
      principal: {
        kind: "USER",
        subject: userId,
        userId,
        issuer: "https://identity.example.test",
      },
    },
    work,
  );
}

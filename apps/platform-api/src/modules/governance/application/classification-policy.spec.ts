import { describe, expect, it } from "vitest";
import type { DataClassification } from "@intelligence/contracts";
import type { GovernanceRepository } from "../domain/governance-repository.js";
import type { Permission, PolicyRequest } from "../domain/governance.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { PolicyEnforcer } from "./policy-enforcer.js";
import { ClassificationPolicy } from "./classification-policy.js";

const access: PolicyRequest = {
  action: "CASE_VIEW",
  resource: { type: "CASE", id: "case-a", workspaceId: "workspace-a" },
  context: {
    caseId: "case-a",
    caseMembershipRequired: true,
    reasonForAccess: "Synthetic review",
  },
};
const noReason: PolicyRequest = {
  ...access,
  context: { caseId: "case-a", caseMembershipRequired: true },
};

describe("ClassificationPolicy", () => {
  it.each(["PUBLIC", "INTERNAL", "SENSITIVE", "RESTRICTED"] as const)(
    "classification %s never replaces base access",
    async (classification) => {
      const { policy, run } = setup([]);
      await expect(
        run(() => policy.display({ access, classification, fieldKind: "IDENTIFIER" })),
      ).resolves.toMatchObject({ visibility: "HIDDEN" });
      await expect(
        run(() =>
          policy.export({
            access,
            classification,
            policy: { enabled: true, redacted: true },
          }),
        ),
      ).resolves.toMatchObject({ allowed: false });
      await expect(
        run(() =>
          policy.sourceAccess({
            access,
            classification,
            policy: {
              enabled: true,
              usePermission: "CASE_VIEW",
              rawPersistence: "SOURCE_POLICY",
            },
          }),
        ),
      ).resolves.toMatchObject({ allowed: false });
    },
  );
  it("defaults to masked identifiers and hidden text at sensitive classifications", async () => {
    const { policy, run } = setup(["CASE_VIEW"]);
    for (const classification of ["SENSITIVE", "RESTRICTED"] as const) {
      await expect(
        run(() => policy.display({ access, classification, fieldKind: "IDENTIFIER" })),
      ).resolves.toMatchObject({ visibility: "MASKED", requiresDurableAudit: false });
      await expect(
        run(() => policy.display({ access, classification, fieldKind: "TEXT" })),
      ).resolves.toMatchObject({ visibility: "HIDDEN" });
    }
    await expect(
      run(() =>
        policy.display({ access, classification: "INTERNAL", fieldKind: "TEXT" }),
      ),
    ).resolves.toMatchObject({ visibility: "FULL" });
  });
  it("requires a full-view grant and reason; use permission gives only match-only", async () => {
    for (const [permission, visibility] of [
      ["IDENTIFIER_USE_RESTRICTED", "MATCH_ONLY"],
      ["IDENTIFIER_VIEW_RESTRICTED", "FULL"],
    ] as const) {
      const { policy, run } = setup(["CASE_VIEW", permission]);
      await expect(
        run(() =>
          policy.display({
            access,
            classification: "RESTRICTED",
            fieldKind: "IDENTIFIER",
          }),
        ),
      ).resolves.toMatchObject({ visibility, requiresDurableAudit: true });
      await expect(
        run(() =>
          policy.display({
            access: noReason,
            classification: "RESTRICTED",
            fieldKind: "IDENTIFIER",
          }),
        ),
      ).resolves.toMatchObject({ visibility: "MASKED" });
    }
  });
  it("applies explicit text policy and cannot bypass a Case boundary with extra grants", async () => {
    const { policy, run } = setup(["CASE_VIEW", "IDENTIFIER_VIEW_RESTRICTED"]);
    await expect(
      run(() =>
        policy.display({
          access,
          classification: "RESTRICTED",
          fieldKind: "TEXT",
          fullViewPermission: "IDENTIFIER_VIEW_RESTRICTED",
        }),
      ),
    ).resolves.toMatchObject({ visibility: "FULL" });
    await expect(
      run(() =>
        policy.display({
          access: { ...access, resource: { ...access.resource, id: "case-b" } },
          classification: "RESTRICTED",
          fieldKind: "IDENTIFIER",
        }),
      ),
    ).resolves.toMatchObject({ visibility: "HIDDEN" });
  });
  it("does not treat PUBLIC as an unconditional export grant", async () => {
    const { policy, run } = setup(["CASE_VIEW"]);
    await expect(
      run(() =>
        policy.export({
          access,
          classification: "PUBLIC",
          policy: { enabled: true, redacted: false },
        }),
      ),
    ).resolves.toMatchObject({ allowed: false });
  });
  it("requires an enabled export policy, permission, reason, and sensitive permission", async () => {
    const { policy, run } = setup([
      "CASE_VIEW",
      "EVIDENCE_EXPORT",
      "IDENTIFIER_VIEW_RESTRICTED",
    ]);
    await expect(
      run(() => policy.export({ access, classification: "PUBLIC" })),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      run(() =>
        policy.export({
          access: noReason,
          classification: "PUBLIC",
          policy: { enabled: true, redacted: false },
        }),
      ),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      run(() =>
        policy.export({
          access,
          classification: "SENSITIVE",
          policy: { enabled: true, redacted: true },
        }),
      ),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      run(() =>
        policy.export({
          access,
          classification: "SENSITIVE",
          policy: {
            enabled: true,
            redacted: false,
            sensitivePermission: "IDENTIFIER_VIEW_RESTRICTED",
          },
        }),
      ),
    ).resolves.toMatchObject({ allowed: true, requiresDurableAudit: true });
  });
  it("never allows unredacted restricted export", async () => {
    const { policy, run } = setup([
      "CASE_VIEW",
      "EVIDENCE_EXPORT",
      "IDENTIFIER_VIEW_RESTRICTED",
    ]);
    for (const redacted of [false, true])
      await expect(
        run(() =>
          policy.export({
            access,
            classification: "RESTRICTED",
            policy: {
              enabled: true,
              redacted,
              sensitivePermission: "IDENTIFIER_VIEW_RESTRICTED",
            },
          }),
        ),
      ).resolves.toMatchObject({ allowed: redacted });
  });
  it("source use does not follow from view and restricted routing/retention cannot be weakened", async () => {
    const view = setup(["CASE_VIEW", "IDENTIFIER_VIEW_RESTRICTED"]);
    const input = {
      access,
      classification: "RESTRICTED" as const,
      policy: {
        enabled: true,
        usePermission: "IDENTIFIER_USE_RESTRICTED" as const,
        restrictedPermission: "IDENTIFIER_USE_RESTRICTED" as const,
        rawPersistence: "SOURCE_POLICY" as const,
      },
    };
    await expect(view.run(() => view.policy.sourceAccess(input))).resolves.toMatchObject({
      allowed: false,
    });
    const use = setup(["CASE_VIEW", "IDENTIFIER_USE_RESTRICTED"]);
    await expect(use.run(() => use.policy.sourceAccess(input))).resolves.toMatchObject({
      allowed: true,
      rawPersistence: "DISABLED",
      requiresDurableAudit: true,
      handling: { workerRouting: "RESTRICTED" },
    });
    await expect(
      use.run(() => use.policy.sourceAccess({ ...input, access: noReason })),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      use.run(() =>
        use.policy.sourceAccess({
          ...input,
          policy: { ...input.policy, enabled: false },
        }),
      ),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      use.run(() =>
        use.policy.sourceAccess({
          ...input,
          policy: { ...input.policy, rawPersistence: "MINIMIZED" },
        }),
      ),
    ).resolves.toMatchObject({ allowed: true, rawPersistence: "MINIMIZED" });
  });
  it("source policy is required, and sensitive raw data is minimized", async () => {
    const { policy, run } = setup(["CASE_VIEW"]);
    await expect(
      run(() => policy.sourceAccess({ access, classification: "PUBLIC" })),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      run(() =>
        policy.sourceAccess({
          access,
          classification: "SENSITIVE",
          policy: {
            enabled: true,
            usePermission: "CASE_VIEW",
            rawPersistence: "SOURCE_POLICY",
          },
        }),
      ),
    ).resolves.toMatchObject({
      allowed: true,
      rawPersistence: "MINIMIZED",
      handling: { workerRouting: "POLICY_DEPENDENT" },
    });
  });
  it("rejects unknown classification instead of falling back to PUBLIC", async () => {
    const { policy, run } = setup(["CASE_VIEW"]);
    await expect(
      run(() =>
        policy.display({
          access,
          classification: "SECRET" as DataClassification,
          fieldKind: "IDENTIFIER",
        }),
      ),
    ).rejects.toMatchObject({ code: "GOVERNANCE_CLASSIFICATION_INVALID" });
  });
  it.each(["SHADOW", "ECHO", "SPECTRA"] as const)(
    "does not branch on %s client application",
    async (clientApplication) => {
      const { policy, run } = setup(["CASE_VIEW"]);
      await expect(
        run(
          () =>
            policy.display({
              access,
              classification: "RESTRICTED",
              fieldKind: "IDENTIFIER",
            }),
          clientApplication,
        ),
      ).resolves.toMatchObject({ visibility: "MASKED" });
    },
  );
});

function setup(permissions: Permission[]) {
  const context = new RequestContextStore();
  const unused = (): never => {
    throw new Error("Unused test operation");
  };
  const repository: GovernanceRepository = {
    createRole: unused,
    createAssignment: unused,
    revokeAssignment: unused,
    async findPermissionGrants(query) {
      if (query.workspaceId !== "workspace-a" || !permissions.includes(query.permission))
        return [];
      return [
        {
          roleId: "role-test",
          permission: query.permission,
          scope: { type: "CASE", resourceId: "case-a" },
          caseMembership: query.permission === "CASE_VIEW",
        },
      ];
    },
  };
  const policy = new ClassificationPolicy(new PolicyEnforcer(repository, context));
  function run<T>(
    work: () => Promise<T>,
    clientApplication: "SHADOW" | "ECHO" | "SPECTRA" = "SHADOW",
  ): Promise<T> {
    return context.run(
      {
        requestId: "synthetic-request",
        traceId: "synthetic-trace",
        issuedAt: new Date().toISOString(),
        clientApplication,
        principal: {
          kind: "USER",
          subject: "synthetic-user",
          userId: "synthetic-user",
          issuer: "https://example.test",
        },
      },
      work,
    );
  }
  return { policy, run };
}

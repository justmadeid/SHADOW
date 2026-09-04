import fs from "node:fs";
import { sql } from "drizzle-orm";
import { version as uuidVersion } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabaseClient,
  DatabaseContext,
  DrizzleTransactionManager,
} from "@intelligence/database";
import { startPostgresTestContainer } from "@intelligence/testing";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import { PolicyEnforcer } from "../../application/policy-enforcer.js";
import { PostgresGovernanceRepository } from "./postgres-governance.repository.js";
import { CASE_ROLE_PERMISSIONS } from "../../domain/case-membership.js";
import { ClassificationPolicy } from "../../application/classification-policy.js";
import type { PolicyRequest } from "../../domain/governance.js";

describe("Governance persistence and enforcement", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let repository: PostgresGovernanceRepository;
  let transactions: DrizzleTransactionManager;
  let context: RequestContextStore;
  let enforcer: PolicyEnforcer;

  const workspaceA = "01992028-0000-7000-8000-000000000001";
  const workspaceB = "01992028-0000-7000-8000-000000000002";
  const caseA = "01992028-0000-7000-8000-000000000011";
  const caseB = "01992028-0000-7000-8000-000000000012";
  const legacyWorkspace = "01992028-0000-7000-8000-000000000003";
  const legacyCase = "01992028-0000-7000-8000-000000000013";

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 5 });
    const database = new DatabaseContext(client.db);
    transactions = new DrizzleTransactionManager(client.db);
    repository = new PostgresGovernanceRepository(database);
    context = new RequestContextStore();
    enforcer = new PolicyEnforcer(repository, context);

    const workspaceMigration = fs.readFileSync(
      new URL(
        "../../../workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const governanceMigration = fs.readFileSync(
      new URL("./migrations/0001_create_governance.sql", import.meta.url),
      "utf8",
    );
    await client.db.execute(sql.raw(workspaceMigration));
    await client.db.execute(
      sql.raw(
        fs.readFileSync(
          new URL(
            "../../../case/infrastructure/persistence/migrations/0001_create_case.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    await client.db.execute(sql.raw(governanceMigration));
    await seedWorkspace(legacyWorkspace, "legacy");
    await client.db.execute(sql`
      INSERT INTO workspace_members (id, workspace_id, user_id, status, joined_at)
      VALUES ('01992028-0000-7000-8000-000000000021', ${legacyWorkspace}, 'legacy-active', 'ACTIVE', now()),
        ('01992028-0000-7000-8000-000000000022', ${legacyWorkspace}, 'legacy-gone', 'REMOVED', now());
    `);
    await client.db.execute(sql`
      INSERT INTO cases (id, code, workspace_id, title, status, classification, revision, created_by_user_id, created_at, updated_at)
      VALUES (${legacyCase}, 'CASE-2026-0000000013', ${legacyWorkspace}, 'Legacy active creator', 'DRAFT', 'SENSITIVE', 1, 'legacy-active', now(), now()),
        ('01992028-0000-7000-8000-000000000014', 'CASE-2026-0000000014', ${legacyWorkspace}, 'Legacy removed creator', 'DRAFT', 'INTERNAL', 1, 'legacy-gone', now(), now()),
        ('01992028-0000-7000-8000-000000000015', 'CASE-2026-0000000015', ${legacyWorkspace}, 'Legacy absent creator', 'DRAFT', 'INTERNAL', 1, 'legacy-absent', now(), now());
    `);
    await client.db.execute(
      sql.raw(
        fs.readFileSync(
          new URL("./migrations/0002_case_membership.sql", import.meta.url),
          "utf8",
        ),
      ),
    );
    await seedWorkspace(workspaceA, "alpha");
    await seedWorkspace(workspaceB, "bravo");
  });

  afterAll(async () => {
    await client?.pool.end();
    await started?.container.stop();
  });

  it("backfills only active legacy creators with UUIDv7 owner membership and durable history", async () => {
    const members = await client.db
      .execute(sql`SELECT a.id, a.subject_id, a.scope_resource_id, r.id AS role_id,
      r.case_role, h.id AS history_id, h.reason, h.actor_subject_type
      FROM governance_role_assignments a JOIN governance_roles r ON r.id = a.role_id
      JOIN governance_assignment_history h ON h.assignment_id = a.id
      WHERE a.workspace_id = ${legacyWorkspace} AND a.case_membership`);
    expect(members.rows).toHaveLength(1);
    const row = members.rows[0]!;
    expect(row).toMatchObject({
      subject_id: "legacy-active",
      scope_resource_id: legacyCase,
      case_role: "OWNER",
      reason: "LEGACY_CASE_CREATOR_BOOTSTRAP",
      actor_subject_type: "SERVICE",
    });
    for (const field of ["id", "role_id", "history_id"])
      expect(uuidVersion(String(row[field]))).toBe(7);
    const permissions = await client.db.execute(
      sql`SELECT permission FROM governance_role_permissions WHERE role_id = ${row.role_id} ORDER BY permission`,
    );
    expect(permissions.rows.map((p) => p.permission)).toEqual(
      [...CASE_ROLE_PERMISSIONS.OWNER].sort(),
    );
    await expect(
      runAsUser("legacy-active", () =>
        enforcer.decide({
          action: "CASE_VIEW",
          resource: { type: "CASE", id: legacyCase, workspaceId: legacyWorkspace },
          context: { caseId: legacyCase, caseMembershipRequired: true },
        }),
      ),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      transactions.run(() =>
        repository.revokeAssignment({
          assignmentId: String(row.id),
          expectedRevision: 1,
          revokedBySubjectType: "USER",
          revokedBySubjectId: "legacy-active",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 412 });
    const active = await client.db.execute(
      sql`SELECT status FROM governance_role_assignments WHERE id = ${row.id}`,
    );
    expect(active.rows[0]?.status).toBe("ACTIVE");
  });

  it("persists UUIDv7 roles, assignments, and append-only grant history", async () => {
    const role = await transactions.run(() =>
      repository.createRole({
        workspaceId: workspaceA,
        key: "case_analyst",
        name: "Case analyst",
        description: "Works only in assigned Cases",
        permissions: ["CASE_VIEW", "CASE_UPDATE"],
      }),
    );
    const assignment = await transactions.run(() =>
      repository.createAssignment({
        workspaceId: workspaceA,
        roleId: role.id,
        subjectType: "USER",
        subjectId: "analyst-a",
        scope: { type: "CASE", resourceId: caseA },
        grantedBySubjectType: "USER",
        grantedBySubjectId: "workspace-owner",
      }),
    );

    expect(uuidVersion(role.id)).toBe(7);
    expect(uuidVersion(assignment.id)).toBe(7);
    expect(role).toMatchObject({
      key: "CASE_ANALYST",
      permissions: ["CASE_UPDATE", "CASE_VIEW"],
    });

    const history = await client.db.execute(sql`
      SELECT action, actor_subject_id
      FROM governance_assignment_history
      WHERE assignment_id = ${assignment.id}
      ORDER BY occurred_at
    `);
    expect(history.rows).toEqual([
      { action: "GRANTED", actor_subject_id: "workspace-owner" },
    ]);
  });

  it("rechecks persisted membership and distinct use/view grants for classified fields", async () => {
    const classifier = new ClassificationPolicy(enforcer);
    const access: PolicyRequest = {
      action: "CASE_VIEW",
      resource: { type: "CASE", id: legacyCase, workspaceId: legacyWorkspace },
      context: {
        caseId: legacyCase,
        caseMembershipRequired: true,
        reasonForAccess: "Synthetic classified review",
      },
    };
    const display = (request = access, user = "legacy-active") =>
      runAsUser(user, () =>
        classifier.display({
          access: request,
          classification: "RESTRICTED",
          fieldKind: "IDENTIFIER",
        }),
      );
    await expect(display()).resolves.toMatchObject({ visibility: "MASKED" });
    const useRole = await transactions.run(() =>
      repository.createRole({
        workspaceId: legacyWorkspace,
        key: "CLASSIFIED_MATCHER",
        name: "Classified matcher",
        permissions: ["IDENTIFIER_USE_RESTRICTED"],
      }),
    );
    const useGrant = await transactions.run(() =>
      repository.createAssignment({
        workspaceId: legacyWorkspace,
        roleId: useRole.id,
        subjectType: "USER",
        subjectId: "legacy-active",
        scope: { type: "CASE", resourceId: legacyCase },
        grantedBySubjectType: "USER",
        grantedBySubjectId: "test-admin",
      }),
    );
    await expect(display()).resolves.toMatchObject({
      visibility: "MATCH_ONLY",
      requiresDurableAudit: true,
    });
    await expect(
      display({
        ...access,
        context: { caseId: legacyCase, caseMembershipRequired: true },
      }),
    ).resolves.toMatchObject({ visibility: "MASKED" });
    await expect(
      display({ ...access, resource: { ...access.resource, id: caseB } }),
    ).resolves.toMatchObject({ visibility: "HIDDEN" });
    await expect(
      display({ ...access, resource: { ...access.resource, workspaceId: workspaceB } }),
    ).resolves.toMatchObject({ visibility: "HIDDEN" });
    await expect(display(access, "legacy-gone")).resolves.toMatchObject({
      visibility: "HIDDEN",
    });
    await transactions.run(() =>
      repository.revokeAssignment({
        assignmentId: useGrant.id,
        expectedRevision: 1,
        revokedBySubjectType: "USER",
        revokedBySubjectId: "test-admin",
      }),
    );
    await expect(display()).resolves.toMatchObject({ visibility: "MASKED" });
    const viewRole = await transactions.run(() =>
      repository.createRole({
        workspaceId: legacyWorkspace,
        key: "CLASSIFIED_READER",
        name: "Classified reader",
        permissions: ["IDENTIFIER_VIEW_RESTRICTED"],
      }),
    );
    await transactions.run(() =>
      repository.createAssignment({
        workspaceId: legacyWorkspace,
        roleId: viewRole.id,
        subjectType: "USER",
        subjectId: "legacy-active",
        scope: { type: "CASE", resourceId: legacyCase },
        grantedBySubjectType: "USER",
        grantedBySubjectId: "test-admin",
      }),
    );
    await expect(display()).resolves.toMatchObject({
      visibility: "FULL",
      requiresDurableAudit: true,
    });
    await expect(
      runAsUser("legacy-active", () =>
        classifier.sourceAccess({
          access,
          classification: "RESTRICTED",
          policy: {
            enabled: true,
            usePermission: "IDENTIFIER_USE_RESTRICTED",
            restrictedPermission: "IDENTIFIER_USE_RESTRICTED",
            rawPersistence: "MINIMIZED",
          },
        }),
      ),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("enforces permission, subject, workspace, and case scope centrally", async () => {
    const allowed = await runAsUser("analyst-a", () =>
      enforcer.decide({
        action: "CASE_VIEW",
        resource: { type: "CASE", id: caseA, workspaceId: workspaceA },
        context: { caseId: caseA },
      }),
    );
    const wrongCase = await runAsUser("analyst-a", () =>
      enforcer.decide({
        action: "CASE_VIEW",
        resource: { type: "CASE", id: caseB, workspaceId: workspaceA },
        context: { caseId: caseB },
      }),
    );
    const wrongUser = await runAsUser("analyst-b", () =>
      enforcer.decide({
        action: "CASE_VIEW",
        resource: { type: "CASE", id: caseA, workspaceId: workspaceA },
        context: { caseId: caseA },
      }),
    );
    const wrongWorkspace = await runAsUser("analyst-a", () =>
      enforcer.decide({
        action: "CASE_VIEW",
        resource: { type: "CASE", id: caseA, workspaceId: workspaceB },
        context: { caseId: caseA },
      }),
    );

    expect(allowed).toMatchObject({ allowed: true, code: "ALLOW_ROLE_GRANT" });
    expect(wrongCase).toMatchObject({
      allowed: false,
      code: "DENY_SCOPE_MISMATCH",
    });
    expect(wrongUser).toMatchObject({
      allowed: false,
      code: "DENY_PERMISSION_MISSING",
    });
    expect(wrongWorkspace).toMatchObject({
      allowed: false,
      code: "DENY_PERMISSION_MISSING",
    });
  });

  it("stops authorization immediately after an assignment is revoked", async () => {
    const grants = await repository.findPermissionGrants({
      workspaceId: workspaceA,
      subjectType: "USER",
      subjectId: "analyst-a",
      permission: "CASE_VIEW",
    });
    expect(grants).toHaveLength(1);

    const assignmentResult = await client.db.execute(sql`
      SELECT id, revision
      FROM governance_role_assignments
      WHERE workspace_id = ${workspaceA}
        AND subject_type = 'USER'
        AND subject_id = 'analyst-a'
        AND status = 'ACTIVE'
      LIMIT 1
    `);
    const assignment = assignmentResult.rows[0] as { id: string; revision: number };
    const revoked = await transactions.run(() =>
      repository.revokeAssignment({
        assignmentId: assignment.id,
        expectedRevision: assignment.revision,
        revokedBySubjectType: "USER",
        revokedBySubjectId: "workspace-owner",
      }),
    );
    const decision = await runAsUser("analyst-a", () =>
      enforcer.decide({
        action: "CASE_VIEW",
        resource: { type: "CASE", id: caseA, workspaceId: workspaceA },
        context: { caseId: caseA },
      }),
    );

    expect(revoked).toMatchObject({ status: "REVOKED", revision: 2 });
    expect(decision).toMatchObject({
      allowed: false,
      code: "DENY_PERMISSION_MISSING",
    });
    const history = await client.db.execute(sql`
      SELECT action
      FROM governance_assignment_history
      WHERE assignment_id = ${assignment.id}
      ORDER BY occurred_at
    `);
    expect(history.rows).toEqual([{ action: "GRANTED" }, { action: "REVOKED" }]);
  });

  it("keeps user and service grants separate", async () => {
    const role = await transactions.run(() =>
      repository.createRole({
        workspaceId: workspaceA,
        key: "ANALYSIS_WORKER",
        name: "Analysis worker",
        description: null,
        permissions: ["INVESTIGATION_UPDATE"],
      }),
    );
    await transactions.run(() =>
      repository.createAssignment({
        workspaceId: workspaceA,
        roleId: role.id,
        subjectType: "SERVICE",
        subjectId: "analysis-worker",
        scope: { type: "WORKSPACE" },
        grantedBySubjectType: "SERVICE",
        grantedBySubjectId: "governance-provisioner",
      }),
    );

    const serviceDecision = await runAsService("analysis-worker", () =>
      enforcer.decide({
        action: "INVESTIGATION_UPDATE",
        resource: { type: "INVESTIGATION", id: caseA, workspaceId: workspaceA },
        context: { caseId: caseA },
      }),
    );
    const userDecision = await runAsUser("analysis-worker", () =>
      enforcer.decide({
        action: "INVESTIGATION_UPDATE",
        resource: { type: "INVESTIGATION", id: caseA, workspaceId: workspaceA },
        context: { caseId: caseA },
      }),
    );

    expect(serviceDecision.allowed).toBe(true);
    expect(userDecision.allowed).toBe(false);
  });

  function runAsUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
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

  function runAsService<T>(serviceId: string, work: () => Promise<T>): Promise<T> {
    return context.run(
      {
        requestId: `request-${serviceId}`,
        traceId: `trace-${serviceId}`,
        issuedAt: new Date().toISOString(),
        principal: {
          kind: "SERVICE",
          subject: serviceId,
          serviceId,
          clientId: serviceId,
          issuer: "https://identity.example.test",
        },
      },
      work,
    );
  }

  async function seedWorkspace(id: string, slug: string): Promise<void> {
    await client.db.execute(sql`
      INSERT INTO workspaces (
        id, name, slug, status, revision, created_by_user_id, created_at, updated_at
      ) VALUES (
        ${id}, ${`Workspace ${slug}`}, ${slug}, 'ACTIVE', 1,
        'workspace-owner', now(), now()
      )
    `);
  }
});

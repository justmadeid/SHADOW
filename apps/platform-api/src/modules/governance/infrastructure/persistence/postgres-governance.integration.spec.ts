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
    await client.db.execute(sql.raw(governanceMigration));
    await seedWorkspace(workspaceA, "alpha");
    await seedWorkspace(workspaceB, "bravo");
  });

  afterAll(async () => {
    await client?.pool.end();
    await started?.container.stop();
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

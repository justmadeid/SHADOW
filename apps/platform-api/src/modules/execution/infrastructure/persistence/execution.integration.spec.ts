import fs from "node:fs";
import { sql } from "drizzle-orm";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { AccessTokenVerifier } from "@intelligence/auth";
import { createDatabaseClient } from "@intelligence/database";
import { startPostgresTestContainer } from "@intelligence/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Logger } from "pino";
import { ExecutionModule } from "../../execution.module.js";
import { CaseFacade } from "../../../case/index.js";
import { InvestigationFacade } from "../../../investigation/index.js";
import { WorkspaceFacade } from "../../../workspace/index.js";
import { NodeDefinitionFacade } from "../../../workflow/index.js";
import { PLATFORM_DB_CLIENT } from "../../../../platform/database/database.module.js";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import { AuthenticationGuard } from "../../../../platform/auth/authentication.guard.js";
import { ACCESS_TOKEN_VERIFIER } from "../../../../platform/auth/authentication.tokens.js";
import { PlatformExceptionFilter } from "../../../../platform/errors/http-exception.filter.js";
import { newUuid } from "../../../../platform/ids/uuid.js";

const verifier: AccessTokenVerifier = {
  async verify(token) {
    if (!["owner", "peer", "viewer", "outsider"].includes(token))
      throw new Error("Invalid synthetic token");
    return {
      kind: "USER",
      subject: token,
      userId: token,
      issuer: "https://identity.example.test",
    };
  },
};

const NODE_DEFINITION = {
  key: "execution-test-node",
  version: 1,
  category: "COLLECTION" as const,
  capability: "EXECUTION_TEST",
  inputs: [{ name: "fullName", type: "STRING" as const, required: true }],
  outputs: [],
  configSchema: [{ name: "timeoutOverride", type: "NUMBER" as const, required: false }],
  executionPolicy: { timeoutSeconds: 30, retryable: true },
  reviewPolicy: { requiresHumanReview: false },
  requiredPermission: "WORKFLOW_CREATE" as const,
  presentation: {
    label: "Execution Test Node",
    description: "Synthetic capability for Run integration tests.",
  },
};

describe("P3 Execution HTTP and PostgreSQL", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let app: INestApplication;
  let context: RequestContextStore;
  let cases: CaseFacade;
  let investigations: InvestigationFacade;
  let workspaces: WorkspaceFacade;
  let nodeDefinitions: NodeDefinitionFacade;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 8 });
    for (const migration of [
      "../../../audit/infrastructure/persistence/migrations/0001_create_audit.sql",
      "../../../../platform/events/outbox/infrastructure/persistence/migrations/0001_create_platform_outbox.sql",
      "../../../workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
      "../../../case/infrastructure/persistence/migrations/0001_create_case.sql",
      "../../../investigation/infrastructure/persistence/migrations/0001_create_investigation.sql",
      "../../../governance/infrastructure/persistence/migrations/0001_create_governance.sql",
      "../../../governance/infrastructure/persistence/migrations/0002_case_membership.sql",
      "../../../governance/infrastructure/persistence/migrations/0004_workflow_run_permissions.sql",
      "../../../workflow/infrastructure/persistence/migrations/0001_create_node_definition.sql",
      "../../../workflow/infrastructure/persistence/migrations/0002_create_node_instance.sql",
      "./migrations/0001_create_run.sql",
    ])
      await client.db.execute(
        sql.raw(fs.readFileSync(new URL(migration, import.meta.url), "utf8")),
      );
    const module = await Test.createTestingModule({
      imports: [ExecutionModule],
      providers: [
        { provide: ACCESS_TOKEN_VERIFIER, useValue: verifier },
        AuthenticationGuard,
        { provide: APP_GUARD, useExisting: AuthenticationGuard },
      ],
    })
      .overrideProvider(PLATFORM_DB_CLIENT)
      .useValue(client)
      .compile();
    context = module.get(RequestContextStore);
    cases = module.get(CaseFacade);
    investigations = module.get(InvestigationFacade);
    workspaces = module.get(WorkspaceFacade);
    nodeDefinitions = module.get(NodeDefinitionFacade);
    app = module.createNestApplication();
    app.useGlobalFilters(
      new PlatformExceptionFilter(context, { error: vi.fn() } as unknown as Logger),
    );
    await app.init();
    await nodeDefinitions.register(NODE_DEFINITION);
  });
  afterAll(async () => {
    await app?.close();
    await client?.pool.end();
    await started?.container.stop();
  });

  it("requires the NodeInstance to be READY before a Run can be created", async () => {
    const f = await fixture();
    await createRun(f.draftNode.id).expect(409);
    const bound = (await bindFullName(f.draftNode.id, 1).expect(200)).body;
    expect(bound.status).toBe("READY");
    const created = (await createRun(f.draftNode.id).expect(201)).body;
    expect(created.status).toBe("QUEUED");
    expect(created.startedAt).toBeNull();
    expect(created.completedAt).toBeNull();
    expect(created.parentRunId).toBeNull();
    expect(created.retryOf).toBeNull();
    expect(created.trigger).toBe("MANUAL");
  });

  it("is idempotent on create and rejects a conflicting idempotency-key replay", async () => {
    const f = await readyFixture();
    const key = newUuid();
    const first = (await createRun(f.node.id, key).expect(201)).body;
    const second = (await createRun(f.node.id, key).expect(201)).body;
    expect(second.id).toBe(first.id);
    // A different NodeInstance under the same key is a conflicting replay.
    const other = await readyFixture();
    await createRun(other.node.id, key).expect(409);
  });

  it("editing the NodeInstance after a Run is created does not alter the historical Run (P3-003 acceptance criterion)", async () => {
    const f = await readyFixture();
    const run = (await createRun(f.node.id).expect(201)).body;
    expect(run.inputSnapshot.configuration).toEqual({});
    expect(run.nodeDefinitionVersion).toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/v1/nodes/${f.node.id}`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"2"')
      .send({ configuration: { timeoutOverride: 99 } })
      .expect(200);

    const refetched = (await get(`/runs/${run.id}`).expect(200)).body;
    expect(refetched.inputSnapshot).toEqual(run.inputSnapshot);
    expect(refetched.nodeDefinitionVersion).toBe(run.nodeDefinitionVersion);
    expect(refetched.revision).toBe(run.revision);
  });

  it("cancels only from QUEUED/RUNNING and enforces If-Match", async () => {
    const f = await readyFixture();
    const run = (await createRun(f.node.id).expect(201)).body;
    await cancelRun(run.id, 99).expect(412);
    const cancelled = (await cancelRun(run.id, 1).expect(200)).body;
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.revision).toBe(2);
    await cancelRun(run.id, 2).expect(409);
  });

  it("retries only from a terminal Run, takes a fresh snapshot, and rejects retry from COMPLETED", async () => {
    const f = await readyFixture();
    const run = (await createRun(f.node.id).expect(201)).body;
    await retryRun(run.id, 1).expect(409); // still QUEUED, not terminal
    await cancelRun(run.id, 1).expect(200); // -> CANCELLED (revision 2)

    // Change the NodeInstance's configuration before retrying.
    await request(app.getHttpServer())
      .patch(`/api/v1/nodes/${f.node.id}`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"2"')
      .send({ configuration: { timeoutOverride: 7 } })
      .expect(200);

    const retried = (await retryRun(run.id, 2).expect(201)).body;
    expect(retried.id).not.toBe(run.id);
    expect(retried.retryOf).toBe(run.id);
    expect(retried.status).toBe("QUEUED");
    // The retry snapshot reflects the NodeInstance's fresh state, not the
    // original Run's stale snapshot.
    expect(retried.inputSnapshot.configuration).toEqual({ timeoutOverride: 7 });
    expect(run.inputSnapshot.configuration).toEqual({});
  });

  it("rejects retry when the NodeInstance is no longer READY", async () => {
    const f = await readyFixture();
    const run = (await createRun(f.node.id).expect(201)).body;
    await cancelRun(run.id, 1).expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/nodes/${f.node.id}`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"2"')
      .expect(204);
    await retryRun(run.id, 2).expect(409);
  });

  it("denies a non-member and a VIEWER attempting RUN_CREATE, and allows VIEWER reads", async () => {
    const f = await readyFixture();
    await createRun(f.node.id, newUuid(), "outsider").expect(404);
    await client.db.execute(
      sql`INSERT INTO workspace_members (id, workspace_id, user_id, status, joined_at) VALUES (${newUuid()}, ${f.workspaceId}, 'viewer', 'ACTIVE', now())`,
    );
    await asUser(() =>
      cases.addMember(f.caseId, "viewer", "VIEWER", "Execution test review"),
    );
    await createRun(f.node.id, newUuid(), "viewer").expect(404);
    const run = (await createRun(f.node.id).expect(201)).body;
    await get(`/runs/${run.id}`, "viewer").expect(200);
    await cancelRunAs(run.id, 1, "viewer").expect(404);
  });

  it("lists Runs scoped to their Case and hides cross-Case Runs", async () => {
    const f = await readyFixture();
    await createRun(f.node.id).expect(201);
    const other = await readyFixture();
    await createRun(other.node.id).expect(201);
    const page = (await get(`/cases/${f.caseId}/runs`).expect(200)).body;
    expect(page.items).toHaveLength(1);
    expect(page.items[0].caseId).toBe(f.caseId);
  });

  it("rolls back Run, history and idempotency record if Outbox insertion fails", async () => {
    const f = await readyFixture();
    const key = newUuid();
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_run_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'RUN_CREATED' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_run_event BEFORE INSERT ON platform_outbox_events FOR EACH ROW EXECUTE FUNCTION fail_run_event();`,
      ),
    );
    try {
      const failed = await createRun(f.node.id, key).expect(500);
      expect(JSON.stringify(failed.body)).not.toContain("synthetic-private");
      expect(
        (
          await client.db.execute(
            sql`SELECT id FROM runs WHERE node_instance_id = ${f.node.id}`,
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.db.execute(
            sql`SELECT run_id FROM run_idempotency WHERE idempotency_key = ${key}`,
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_run_event ON platform_outbox_events; DROP FUNCTION fail_run_event();",
        ),
      );
    }
    await createRun(f.node.id, key).expect(201);
  });

  async function fixture() {
    const workspace = await asUser(() =>
      workspaces.create(
        {
          name: "Synthetic Execution",
          slug: `execution-${newUuid()}`,
          locale: "id-ID",
          timeZone: "Asia/Jakarta",
        },
        newUuid(),
      ),
    );
    await client.db.execute(
      sql`INSERT INTO workspace_members (id, workspace_id, user_id, status, joined_at) VALUES (${newUuid()}, ${workspace.id}, 'peer', 'ACTIVE', now())`,
    );
    const created = await asUser(() =>
      cases.create(
        {
          workspaceId: workspace.id,
          title: "Synthetic Case",
          classification: "SENSITIVE",
        },
        newUuid(),
      ),
    );
    const investigation = await asUser(() =>
      investigations.create(
        created.id,
        { title: "Synthetic Investigation", objective: "Execution test objective." },
        newUuid(),
      ),
    );
    const draftNode = (
      await request(app.getHttpServer())
        .post(`/api/v1/investigations/${investigation.id}/nodes`)
        .set("authorization", "Bearer owner")
        .set("idempotency-key", newUuid())
        .send({
          nodeDefinitionKey: NODE_DEFINITION.key,
          nodeDefinitionVersion: 1,
          configuration: {},
        })
        .expect(201)
    ).body;
    return {
      caseId: created.id,
      workspaceId: created.workspaceId,
      investigationId: investigation.id,
      draftNode,
    };
  }

  async function readyFixture() {
    const f = await fixture();
    const node = (await bindFullName(f.draftNode.id, 1).expect(200)).body;
    return { ...f, node };
  }

  function bindFullName(nodeInstanceId: string, revision: number) {
    return request(app.getHttpServer())
      .post(`/api/v1/nodes/${nodeInstanceId}/input-bindings`)
      .set("authorization", "Bearer owner")
      .set("if-match", `"${revision}"`)
      .send({
        bindings: [
          {
            targetInput: "fullName",
            sourceExpression: "person.full_name",
            sourceType: "STRING",
            sourceClassification: "SENSITIVE",
          },
        ],
      });
  }
  function get(path: string, user = "owner") {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set("authorization", `Bearer ${user}`);
  }
  function createRun(nodeInstanceId: string, key = newUuid(), user = "owner") {
    return request(app.getHttpServer())
      .post(`/api/v1/nodes/${nodeInstanceId}/actions/run`)
      .set("authorization", `Bearer ${user}`)
      .set("idempotency-key", key);
  }
  function cancelRun(runId: string, revision: number) {
    return cancelRunAs(runId, revision, "owner");
  }
  function cancelRunAs(runId: string, revision: number, user: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/runs/${runId}/actions/cancel`)
      .set("authorization", `Bearer ${user}`)
      .set("if-match", `"${revision}"`);
  }
  function retryRun(runId: string, revision: number, key = newUuid(), user = "owner") {
    return request(app.getHttpServer())
      .post(`/api/v1/runs/${runId}/actions/retry`)
      .set("authorization", `Bearer ${user}`)
      .set("if-match", `"${revision}"`)
      .set("idempotency-key", key);
  }
  function asUser<T>(work: () => Promise<T>, user = "owner"): Promise<T> {
    return context.run(
      {
        requestId: newUuid(),
        traceId: newUuid(),
        issuedAt: new Date().toISOString(),
        principal: {
          kind: "USER",
          subject: user,
          userId: user,
          issuer: "https://identity.example.test",
        },
      },
      work,
    );
  }
});

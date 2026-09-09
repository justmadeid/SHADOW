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
    if (["owner", "peer", "viewer", "outsider"].includes(token))
      return {
        kind: "USER",
        subject: token,
        userId: token,
        issuer: "https://identity.example.test",
      };
    if (token === "connector-worker")
      return {
        kind: "SERVICE",
        subject: token,
        serviceId: token,
        issuer: "https://identity.example.test",
      };
    throw new Error("Invalid synthetic token");
  },
};

const NODE_DEFINITION = {
  key: "execution-attempt-test-node",
  version: 1,
  category: "COLLECTION" as const,
  capability: "EXECUTION_ATTEMPT_TEST",
  inputs: [{ name: "fullName", type: "STRING" as const, required: true }],
  outputs: [],
  configSchema: [],
  executionPolicy: { timeoutSeconds: 42, retryable: true },
  reviewPolicy: { requiresHumanReview: false },
  requiredPermission: "WORKFLOW_CREATE" as const,
  presentation: {
    label: "Execution Attempt Test Node",
    description: "Synthetic capability for ExecutionAttempt integration tests.",
  },
};

describe("P3-004/005 ExecutionAttempt + ExecutionPlan HTTP and PostgreSQL", () => {
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
      "./migrations/0002_create_execution_attempt.sql",
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

  it("rejects every internal/v1 endpoint for a USER principal with AUTH_SERVICE_REQUIRED", async () => {
    const f = await runFixture();
    const owner = "Bearer owner";

    const attemptsResponse = await request(app.getHttpServer())
      .post(`/internal/v1/runs/${f.run.id}/attempts`)
      .set("authorization", owner)
      .set("idempotency-key", newUuid())
      .send({ leaseOwner: "worker-a", leaseDurationSeconds: 30 })
      .expect(403);
    expect(attemptsResponse.body.error.code).toBe("AUTH_SERVICE_REQUIRED");

    // A real (SERVICE-created) attempt exists so attemptId-shaped bodies below
    // are structurally valid — authorization must still fail before any of
    // that is even consulted.
    const attempt = (await createAttempt(f.run.id).expect(201)).body;

    const progressResponse = await request(app.getHttpServer())
      .post(`/internal/v1/runs/${f.run.id}/progress`)
      .set("authorization", owner)
      .send({ attemptId: attempt.id, stage: "fetching" })
      .expect(403);
    expect(progressResponse.body.error.code).toBe("AUTH_SERVICE_REQUIRED");

    const completeResponse = await request(app.getHttpServer())
      .post(`/internal/v1/runs/${f.run.id}/actions/complete`)
      .set("authorization", owner)
      .send({ attemptId: attempt.id, outcome: "COMPLETED" })
      .expect(403);
    expect(completeResponse.body.error.code).toBe("AUTH_SERVICE_REQUIRED");

    const failResponse = await request(app.getHttpServer())
      .post(`/internal/v1/runs/${f.run.id}/actions/fail`)
      .set("authorization", owner)
      .send({ attemptId: attempt.id, errorCode: "SOURCE_TIMEOUT", retryable: true })
      .expect(403);
    expect(failResponse.body.error.code).toBe("AUTH_SERVICE_REQUIRED");

    const planResponse = await request(app.getHttpServer())
      .get(`/internal/v1/runs/${f.run.id}/execution-plan`)
      .set("authorization", owner)
      .expect(403);
    expect(planResponse.body.error.code).toBe("AUTH_SERVICE_REQUIRED");

    // None of the above ever actually mutated the Attempt/Run despite the
    // structurally-valid bodies: still LEASED, Run still RUNNING.
    const run = (await getRun(f.run.id)).body;
    expect(run.status).toBe("RUNNING");
  });

  it("creates the first Attempt (attemptNumber 1) and transitions the Run QUEUED -> RUNNING with startedAt set", async () => {
    const f = await runFixture();
    const created = (await createAttempt(f.run.id).expect(201)).body;
    expect(created.attemptNumber).toBe(1);
    expect(created.status).toBe("LEASED");
    expect(created.workerIdentity).toBe("connector-worker");

    const run = (await getRun(f.run.id)).body;
    expect(run.status).toBe("RUNNING");
    expect(run.startedAt).not.toBeNull();
  });

  it("is idempotent on create and rejects a conflicting idempotency-key replay", async () => {
    const f = await runFixture();
    const key = newUuid();
    const first = (await createAttempt(f.run.id, key).expect(201)).body;
    const second = (await createAttempt(f.run.id, key).expect(201)).body;
    expect(second.id).toBe(first.id);

    const other = await runFixture();
    await createAttempt(other.run.id, key).expect(409);
  });

  it("rejects a second attempt while the first is still leased (RUN_ATTEMPT_ALREADY_ACTIVE)", async () => {
    const f = await runFixture();
    await createAttempt(f.run.id).expect(201);
    const conflict = await createAttempt(f.run.id).expect(409);
    expect(conflict.body.error.code).toBe("RUN_ATTEMPT_ALREADY_ACTIVE");
  });

  it("lazily marks an expired attempt LOST and allows a new attempt (attemptNumber 2) on the same Run", async () => {
    const f = await runFixture();
    const first = (await createAttempt(f.run.id, newUuid(), 1).expect(201)).body;
    // Force the lease to have already expired.
    await client.db.execute(
      sql`UPDATE execution_attempts SET leased_until = now() - interval '1 second' WHERE id = ${first.id}`,
    );
    const second = (await createAttempt(f.run.id).expect(201)).body;
    expect(second.attemptNumber).toBe(2);

    const lost = await client.db.execute(
      sql`SELECT status FROM execution_attempts WHERE id = ${first.id}`,
    );
    expect(lost.rows[0]?.status).toBe("LOST");
  });

  it("rejects a new attempt once the Run is terminal (RUN_NOT_ATTEMPTABLE)", async () => {
    const f = await runFixture();
    await request(app.getHttpServer())
      .post(`/api/v1/runs/${f.run.id}/actions/cancel`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .expect(200);
    const conflict = await createAttempt(f.run.id).expect(409);
    expect(conflict.body.error.code).toBe("RUN_NOT_ATTEMPTABLE");
  });

  it("records progress as a heartbeat: extends the lease, flips LEASED to RUNNING, never derives a percentage", async () => {
    const f = await runFixture();
    const attempt = (await createAttempt(f.run.id).expect(201)).body;
    const before = new Date(attempt.leasedUntil).getTime();

    const updated = (
      await request(app.getHttpServer())
        .post(`/internal/v1/runs/${f.run.id}/progress`)
        .set("authorization", "Bearer connector-worker")
        .send({
          attemptId: attempt.id,
          stage: "fetching",
          processed: 3,
          produced: 3,
          total: null,
        })
        .expect(200)
    ).body;

    expect(updated.status).toBe("RUNNING");
    expect(new Date(updated.leasedUntil).getTime()).toBeGreaterThan(before);
    expect(updated.lastProgress).toEqual({
      stage: "fetching",
      processed: 3,
      produced: 3,
      total: null,
    });
  });

  it("rejects progress for an attemptId that is not the Run's current active attempt", async () => {
    const f = await runFixture();
    await createAttempt(f.run.id).expect(201);
    const rejected = await request(app.getHttpServer())
      .post(`/internal/v1/runs/${f.run.id}/progress`)
      .set("authorization", "Bearer connector-worker")
      .send({
        attemptId: newUuid(),
        stage: "fetching",
        processed: null,
        produced: null,
        total: null,
      })
      .expect(404);
    expect(rejected.body.error.code).toBe("EXECUTION_ATTEMPT_NOT_FOUND");
  });

  it(
    "P3-004 acceptance criterion: a retryable fail requeues the Run, and a new Attempt " +
      "(attemptNumber 2) can then be created on the same Run",
    async () => {
      const f = await runFixture();
      const attempt = (await createAttempt(f.run.id).expect(201)).body;

      const failed = (
        await request(app.getHttpServer())
          .post(`/internal/v1/runs/${f.run.id}/actions/fail`)
          .set("authorization", "Bearer connector-worker")
          .send({ attemptId: attempt.id, errorCode: "SOURCE_TIMEOUT", retryable: true })
          .expect(200)
      ).body;
      expect(failed.status).toBe("QUEUED");

      const secondAttempt = (await createAttempt(f.run.id).expect(201)).body;
      expect(secondAttempt.attemptNumber).toBe(2);
      expect(secondAttempt.runId).toBe(f.run.id);

      const run = (await getRun(f.run.id)).body;
      expect(run.status).toBe("RUNNING");
    },
  );

  it("a non-retryable fail terminates the Run FAILED", async () => {
    const f = await runFixture();
    const attempt = (await createAttempt(f.run.id).expect(201)).body;
    const failed = (
      await request(app.getHttpServer())
        .post(`/internal/v1/runs/${f.run.id}/actions/fail`)
        .set("authorization", "Bearer connector-worker")
        .send({
          attemptId: attempt.id,
          errorCode: "SOURCE_AUTH_FAILED",
          retryable: false,
        })
        .expect(200)
    ).body;
    expect(failed.status).toBe("FAILED");
    expect(failed.completedAt).not.toBeNull();
  });

  it("completes the Run and is idempotent on an exact attempt+outcome replay", async () => {
    const f = await runFixture();
    const attempt = (await createAttempt(f.run.id).expect(201)).body;
    const complete = () =>
      request(app.getHttpServer())
        .post(`/internal/v1/runs/${f.run.id}/actions/complete`)
        .set("authorization", "Bearer connector-worker")
        .send({ attemptId: attempt.id, outcome: "COMPLETED" });

    const first = (await complete().expect(200)).body;
    expect(first.status).toBe("COMPLETED");
    const replay = (await complete().expect(200)).body;
    expect(replay.status).toBe("COMPLETED");
    expect(replay.revision).toBe(first.revision);
  });

  it("rejects completing an already-terminal Run with a different outcome (RUN_ALREADY_TERMINAL)", async () => {
    const f = await runFixture();
    const attempt = (await createAttempt(f.run.id).expect(201)).body;
    await request(app.getHttpServer())
      .post(`/internal/v1/runs/${f.run.id}/actions/complete`)
      .set("authorization", "Bearer connector-worker")
      .send({ attemptId: attempt.id, outcome: "COMPLETED" })
      .expect(200);
    const conflict = await request(app.getHttpServer())
      .post(`/internal/v1/runs/${f.run.id}/actions/complete`)
      .set("authorization", "Bearer connector-worker")
      .send({ attemptId: attempt.id, outcome: "PARTIAL" })
      .expect(409);
    expect(conflict.body.error.code).toBe("RUN_ALREADY_TERMINAL");
  });

  it("ExecutionPlan is unavailable before any Attempt exists, and available (connector/checkpoint null) once one does", async () => {
    const f = await runFixture();
    const unavailable = await request(app.getHttpServer())
      .get(`/internal/v1/runs/${f.run.id}/execution-plan`)
      .set("authorization", "Bearer connector-worker")
      .expect(409);
    expect(unavailable.body.error.code).toBe("RUN_EXECUTION_PLAN_NOT_AVAILABLE");

    const attempt = (await createAttempt(f.run.id).expect(201)).body;
    const plan = (
      await request(app.getHttpServer())
        .get(`/internal/v1/runs/${f.run.id}/execution-plan`)
        .set("authorization", "Bearer connector-worker")
        .expect(200)
    ).body;

    expect(plan.runId).toBe(f.run.id);
    expect(plan.attempt).toEqual({
      id: attempt.id,
      attemptNumber: 1,
      leaseOwner: "worker-instance-a",
    });
    expect(plan.capability).toBe("EXECUTION_ATTEMPT_TEST");
    expect(plan.connector).toBeNull();
    expect(plan.checkpoint).toBeNull();
    expect(plan.limits).toEqual({ timeoutSeconds: 42 });
    expect(JSON.stringify(plan).toLowerCase()).not.toMatch(
      /secret|apikey|api_key|token|credential|password/,
    );
  });

  async function runFixture() {
    const workspace = await asUser(() =>
      workspaces.create(
        {
          name: "Synthetic Execution Attempt",
          slug: `execution-attempt-${newUuid()}`,
          locale: "id-ID",
          timeZone: "Asia/Jakarta",
        },
        newUuid(),
      ),
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
        {
          title: "Synthetic Investigation",
          objective: "ExecutionAttempt test objective.",
        },
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
    const readyNode = (
      await request(app.getHttpServer())
        .post(`/api/v1/nodes/${draftNode.id}/input-bindings`)
        .set("authorization", "Bearer owner")
        .set("if-match", '"1"')
        .send({
          bindings: [
            {
              targetInput: "fullName",
              sourceExpression: "person.full_name",
              sourceType: "STRING",
              sourceClassification: "SENSITIVE",
            },
          ],
        })
        .expect(200)
    ).body;
    const run = (
      await request(app.getHttpServer())
        .post(`/api/v1/nodes/${readyNode.id}/actions/run`)
        .set("authorization", "Bearer owner")
        .set("idempotency-key", newUuid())
        .expect(201)
    ).body;
    return { workspaceId: workspace.id, caseId: created.id, node: readyNode, run };
  }

  function createAttempt(runId: string, key = newUuid(), leaseDurationSeconds = 30) {
    return request(app.getHttpServer())
      .post(`/internal/v1/runs/${runId}/attempts`)
      .set("authorization", "Bearer connector-worker")
      .set("idempotency-key", key)
      .send({ leaseOwner: "worker-instance-a", leaseDurationSeconds });
  }

  function getRun(runId: string) {
    return request(app.getHttpServer())
      .get(`/api/v1/runs/${runId}`)
      .set("authorization", "Bearer owner");
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

import fs from "node:fs";
import { sql } from "drizzle-orm";
import pino from "pino";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { AccessTokenVerifier } from "@intelligence/auth";
import { createDatabaseClient, DatabaseContext } from "@intelligence/database";
import {
  startPostgresTestContainer,
  startRedisTestContainer,
} from "@intelligence/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { ExecutionModule } from "../../../../../modules/execution/execution.module.js";
import { CaseFacade } from "../../../../../modules/case/index.js";
import { InvestigationFacade } from "../../../../../modules/investigation/index.js";
import { WorkspaceFacade } from "../../../../../modules/workspace/index.js";
import { NodeDefinitionFacade } from "../../../../../modules/workflow/index.js";
import { PLATFORM_DB_CLIENT } from "../../../../database/database.module.js";
import { RequestContextStore } from "../../../../request-context/index.js";
import { AuthenticationGuard } from "../../../../auth/authentication.guard.js";
import { ACCESS_TOKEN_VERIFIER } from "../../../../auth/authentication.tokens.js";
import { PlatformExceptionFilter } from "../../../../errors/http-exception.filter.js";
import { newUuid } from "../../../../ids/uuid.js";
import { OutboxDispatcher } from "../../application/outbox-dispatcher.js";
import { PostgresOutboxStore } from "../persistence/postgres-outbox.store.js";
import { BullMqOutboxPublisher } from "./bullmq-outbox-publisher.js";
import { createConnectorGeneralQueue } from "./connector-general-queue.js";

const verifier: AccessTokenVerifier = {
  async verify(token) {
    if (token !== "owner") throw new Error("Invalid synthetic token");
    return {
      kind: "USER",
      subject: token,
      userId: token,
      issuer: "https://identity.example.test",
    };
  },
};

const NODE_DEFINITION = {
  key: "dispatch-test-node",
  version: 1,
  category: "COLLECTION" as const,
  capability: "DISPATCH_TEST",
  inputs: [],
  outputs: [],
  configSchema: [],
  executionPolicy: { timeoutSeconds: 30, retryable: true },
  reviewPolicy: { requiresHumanReview: false },
  requiredPermission: "WORKFLOW_CREATE" as const,
  presentation: {
    label: "Dispatch Test Node",
    description: "Synthetic capability for dispatch tests.",
  },
};

describe("P3-006 Outbox -> BullMQ dispatch (Postgres + Redis)", () => {
  let postgres: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let redis: Awaited<ReturnType<typeof startRedisTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let app: INestApplication;
  let context: RequestContextStore;
  let cases: CaseFacade;
  let investigations: InvestigationFacade;
  let workspaces: WorkspaceFacade;
  let nodeDefinitions: NodeDefinitionFacade;
  let store: PostgresOutboxStore;
  const logger = pino({ enabled: false });

  beforeAll(async () => {
    postgres = await startPostgresTestContainer();
    redis = await startRedisTestContainer();
    client = createDatabaseClient({ databaseUrl: postgres.databaseUrl, maxPoolSize: 8 });
    for (const migration of [
      "../../../../../modules/audit/infrastructure/persistence/migrations/0001_create_audit.sql",
      "../persistence/migrations/0001_create_platform_outbox.sql",
      "../../../../../modules/workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
      "../../../../../modules/case/infrastructure/persistence/migrations/0001_create_case.sql",
      "../../../../../modules/investigation/infrastructure/persistence/migrations/0001_create_investigation.sql",
      "../../../../../modules/governance/infrastructure/persistence/migrations/0001_create_governance.sql",
      "../../../../../modules/governance/infrastructure/persistence/migrations/0002_case_membership.sql",
      "../../../../../modules/governance/infrastructure/persistence/migrations/0004_workflow_run_permissions.sql",
      "../../../../../modules/workflow/infrastructure/persistence/migrations/0001_create_node_definition.sql",
      "../../../../../modules/workflow/infrastructure/persistence/migrations/0002_create_node_instance.sql",
      "../../../../../modules/execution/infrastructure/persistence/migrations/0001_create_run.sql",
      "../../../../../modules/execution/infrastructure/persistence/migrations/0002_create_execution_attempt.sql",
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
    app.useGlobalFilters(new PlatformExceptionFilter(context, logger as never));
    await app.init();
    await nodeDefinitions.register(NODE_DEFINITION);

    store = new PostgresOutboxStore(
      new DatabaseContext(client.db),
      new RequestContextStore(),
    );
  });

  afterAll(async () => {
    await app?.close();
    await client?.pool.end();
    await postgres?.container.stop();
    await redis?.container.stop();
  });

  it(
    "dispatches only RUN_CREATED to connector.general when a non-RUN_CREATED event " +
      "(SUBJECT_CREATED-shaped, enqueued the same way a real module facade would) is pending " +
      "alongside it, leaving the other event unclaimed and unpublished",
    async () => {
      await store.enqueue({
        type: "SUBJECT_CREATED",
        version: 1,
        payload: { resourceId: "subject-safety-1" },
      });

      const run = await createRun();
      const { queue, close } = createConnectorGeneralQueue(redis.redisUrl);
      try {
        const publisher = new BullMqOutboxPublisher(queue);
        const dispatcher = new OutboxDispatcher(store, publisher, logger);

        const result = await dispatcher.dispatchOnce({
          leaseOwner: "test-dispatcher-safety",
          eventTypes: ["RUN_CREATED"],
          batchSize: 10,
          leaseDurationMs: 30_000,
        });

        expect(result.published).toBeGreaterThanOrEqual(1);

        const subjectRow = await client.db.execute(
          sql`SELECT published_at FROM platform_outbox_events WHERE event_type = 'SUBJECT_CREATED' AND payload->>'resourceId' = 'subject-safety-1'`,
        );
        expect(subjectRow.rows[0]?.published_at).toBeNull();

        const runRow = await client.db.execute(
          sql`SELECT published_at FROM platform_outbox_events WHERE event_type = 'RUN_CREATED' AND aggregate_id = ${run.id}`,
        );
        expect(runRow.rows[0]?.published_at).not.toBeNull();

        const jobCounts = await queue.getJobCounts();
        expect(
          (jobCounts.waiting ?? 0) + (jobCounts.completed ?? 0),
        ).toBeGreaterThanOrEqual(1);
      } finally {
        await close();
      }
    },
    20_000,
  );

  it("a duplicate dispatch of the same event is idempotent: the deterministic jobId is deduped by BullMQ", async () => {
    const run = await createRun();
    const { queue, close } = createConnectorGeneralQueue(redis.redisUrl);
    try {
      const publisher = new BullMqOutboxPublisher(queue);
      const eventRow = await client.db.execute(
        sql`SELECT id FROM platform_outbox_events WHERE event_type = 'RUN_CREATED' AND aggregate_id = ${run.id} LIMIT 1`,
      );
      const outboxEventId = String(eventRow.rows[0]?.id);

      const fakeEvent = {
        id: outboxEventId,
        type: "RUN_CREATED",
        version: 1,
        aggregateType: "RUN",
        aggregateId: run.id,
        payload: {},
        requestId: null,
        traceParent: null,
        occurredAt: new Date(),
        availableAt: new Date(),
        attemptCount: 1,
        leaseOwner: "x",
        leasedUntil: new Date(),
        publishedAt: null,
        lastErrorCode: null,
        lastErrorAt: null,
      };

      // The queue is shared with other tests in this file, so assert the
      // delta caused by these two publishes rather than an absolute count.
      const before = await queue.getJobCounts();
      const beforeTotal =
        (before.waiting ?? 0) + (before.active ?? 0) + (before.completed ?? 0);

      await publisher.publish(fakeEvent);
      await publisher.publish(fakeEvent); // simulated re-dispatch (e.g. a lease-loss race re-claiming the row)

      const after = await queue.getJobCounts();
      const afterTotal =
        (after.waiting ?? 0) + (after.active ?? 0) + (after.completed ?? 0);
      expect(afterTotal - beforeTotal).toBe(1);

      const job = await queue.getJob(outboxEventId);
      expect(job).toBeDefined();
    } finally {
      await close();
    }
  }, 20_000);

  it(
    "broker outage does not roll back the committed Run: creation still commits and is " +
      "readable, and the dispatch cycle fails gracefully leaving the Run row and outbox " +
      "event untouched (attemptCount incremented, rescheduled, still unpublished)",
    async () => {
      const run = await createRun();

      const before = await client.db.execute(
        sql`SELECT attempt_count FROM platform_outbox_events WHERE event_type = 'RUN_CREATED' AND aggregate_id = ${run.id}`,
      );
      const beforeAttemptCount = Number(before.rows[0]?.attempt_count ?? 0);

      // Unreachable Redis: nothing listens on this port.
      const { queue, close } = createConnectorGeneralQueue("redis://127.0.0.1:65535");
      try {
        const publisher = new BullMqOutboxPublisher(queue);
        const dispatcher = new OutboxDispatcher(store, publisher, logger);

        const result = await dispatcher.dispatchOnce({
          leaseOwner: "test-dispatcher-outage",
          eventTypes: ["RUN_CREATED"],
          batchSize: 10,
          leaseDurationMs: 30_000,
        });

        expect(result.failed).toBeGreaterThanOrEqual(1);

        const stillThere = await client.db.execute(
          sql`SELECT id, status FROM runs WHERE id = ${run.id}`,
        );
        expect(stillThere.rows).toHaveLength(1);

        const after = await client.db.execute(
          sql`SELECT attempt_count, published_at FROM platform_outbox_events WHERE event_type = 'RUN_CREATED' AND aggregate_id = ${run.id}`,
        );
        expect(after.rows[0]?.published_at).toBeNull();
        expect(Number(after.rows[0]?.attempt_count)).toBeGreaterThan(beforeAttemptCount);
      } finally {
        await close();
      }
    },
    20_000,
  );

  async function createRun(): Promise<{ id: string }> {
    const workspace = await asUser(() =>
      workspaces.create(
        {
          name: "Synthetic Dispatch",
          slug: `dispatch-${newUuid()}`,
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
          title: "Synthetic Dispatch Case",
          classification: "SENSITIVE",
        },
        newUuid(),
      ),
    );
    const investigation = await asUser(() =>
      investigations.create(
        created.id,
        {
          title: "Synthetic Dispatch Investigation",
          objective: "Dispatch test objective.",
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
    const run = (
      await request(app.getHttpServer())
        .post(`/api/v1/nodes/${draftNode.id}/actions/run`)
        .set("authorization", "Bearer owner")
        .set("idempotency-key", newUuid())
        .expect(201)
    ).body;
    return { id: run.id };
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

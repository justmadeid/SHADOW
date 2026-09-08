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
import { WorkflowModule } from "../../workflow.module.js";
import { CaseFacade } from "../../../case/index.js";
import { InvestigationFacade } from "../../../investigation/index.js";
import { WorkspaceFacade } from "../../../workspace/index.js";
import { NodeDefinitionFacade } from "../../application/node-definition.facade.js";
import { PLATFORM_DB_CLIENT } from "../../../../platform/database/database.module.js";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import { AuthenticationGuard } from "../../../../platform/auth/authentication.guard.js";
import { ACCESS_TOKEN_VERIFIER } from "../../../../platform/auth/authentication.tokens.js";
import { PlatformExceptionFilter } from "../../../../platform/errors/http-exception.filter.js";
import { newUuid } from "../../../../platform/ids/uuid.js";

const verifier: AccessTokenVerifier = {
  async verify(token) {
    if (token === "worker")
      return {
        kind: "SERVICE",
        subject: token,
        serviceId: token,
        clientId: token,
        issuer: "https://identity.example.test",
      };
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

const REQUIRED_DEFINITION = {
  key: "workflow-test-required",
  version: 1,
  category: "COLLECTION" as const,
  capability: "WORKFLOW_TEST_REQUIRED",
  inputs: [{ name: "fullName", type: "STRING" as const, required: true }],
  outputs: [{ name: "matchCount", type: "NUMBER" as const, required: false }],
  configSchema: [{ name: "timeoutOverride", type: "NUMBER" as const, required: false }],
  executionPolicy: { timeoutSeconds: 30, retryable: true },
  reviewPolicy: { requiresHumanReview: false },
  requiredPermission: "WORKFLOW_CREATE" as const,
  presentation: {
    label: "Required Input Node",
    description: "Synthetic test capability with one required input.",
  },
};

const OPTIONAL_DEFINITION = {
  ...REQUIRED_DEFINITION,
  key: "workflow-test-optional",
  capability: "WORKFLOW_TEST_OPTIONAL",
  inputs: [{ name: "query", type: "STRING" as const, required: false }],
  presentation: {
    label: "Optional Input Node",
    description: "Synthetic test capability with no required inputs.",
  },
};

describe("P3 Workflow HTTP and PostgreSQL", () => {
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
      "./migrations/0001_create_node_definition.sql",
      "./migrations/0002_create_node_instance.sql",
    ])
      await client.db.execute(
        sql.raw(fs.readFileSync(new URL(migration, import.meta.url), "utf8")),
      );
    const module = await Test.createTestingModule({
      imports: [WorkflowModule],
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

    // Trusted-port registration: mirrors how a future capability-owning module
    // would call NodeDefinitionFacade.register() directly (never via HTTP).
    await nodeDefinitions.register(REQUIRED_DEFINITION);
    await nodeDefinitions.register(OPTIONAL_DEFINITION);
  });
  afterAll(async () => {
    await app?.close();
    await client?.pool.end();
    await started?.container.stop();
  });

  it("registers idempotently on exact key+version and rejects a differing shape (P3-001)", async () => {
    const replayed = await nodeDefinitions.register(REQUIRED_DEFINITION);
    const original = await asUser(() => nodeDefinitions.get(REQUIRED_DEFINITION.key, 1));
    expect(replayed.id).toBe(original.id);
    await expect(
      nodeDefinitions.register({
        ...REQUIRED_DEFINITION,
        presentation: { label: "Changed", description: "Changed description." },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT_NODE_DEFINITION_KEY_VERSION_REUSED" });
  });

  it("lists only the latest ACTIVE version per key and serves exact key+version reads", async () => {
    await nodeDefinitions.register({ ...REQUIRED_DEFINITION, version: 2 });
    const list = await get("/node-definitions").expect(200);
    const entry = list.body.items.find(
      (item: { key: string }) => item.key === REQUIRED_DEFINITION.key,
    );
    expect(entry.version).toBe(2);
    await get(`/node-definitions/${REQUIRED_DEFINITION.key}/versions/1`).expect(200);
    await get(`/node-definitions/${REQUIRED_DEFINITION.key}/versions/99`).expect(404);
    await get("/node-definitions/not-a-real-key/versions/1").expect(404);
  });

  it("creates a NodeInstance DRAFT when a required input is unbound, READY when none are required", async () => {
    const f = await fixture();
    const draft = (
      await createNode(f.investigationId, {
        nodeDefinitionKey: REQUIRED_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      }).expect(201)
    ).body;
    expect(draft.status).toBe("DRAFT");
    const ready = (
      await createNode(f.investigationId, {
        nodeDefinitionKey: OPTIONAL_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      }).expect(201)
    ).body;
    expect(ready.status).toBe("READY");
  });

  it("is idempotent on create and rejects a conflicting idempotency-key replay", async () => {
    const f = await fixture();
    const key = newUuid();
    const body = {
      nodeDefinitionKey: OPTIONAL_DEFINITION.key,
      nodeDefinitionVersion: 1,
      configuration: {},
    };
    const first = (await createNode(f.investigationId, body, key).expect(201)).body;
    const second = (await createNode(f.investigationId, body, key).expect(201)).body;
    expect(second.id).toBe(first.id);
    await createNode(
      f.investigationId,
      { ...body, configuration: { timeoutOverride: 5 } },
      key,
    ).expect(409);
  });

  it("rejects configuration that does not match the NodeDefinition's configSchema", async () => {
    const f = await fixture();
    await createNode(f.investigationId, {
      nodeDefinitionKey: OPTIONAL_DEFINITION.key,
      nodeDefinitionVersion: 1,
      configuration: { unknownKey: "x" },
    }).expect(400);
    await createNode(f.investigationId, {
      nodeDefinitionKey: OPTIONAL_DEFINITION.key,
      nodeDefinitionVersion: 1,
      configuration: { timeoutOverride: "five" },
    }).expect(400);
  });

  it("requires an ACTIVE NodeDefinition and an ACTIVE Investigation", async () => {
    const f = await fixture();
    await createNode(f.investigationId, {
      nodeDefinitionKey: "no-such-key",
      nodeDefinitionVersion: 1,
      configuration: {},
    }).expect(404);
    await client.db.execute(
      sql`UPDATE node_definitions SET status = 'DEPRECATED' WHERE key = ${OPTIONAL_DEFINITION.key} AND version = 1`,
    );
    await createNode(f.investigationId, {
      nodeDefinitionKey: OPTIONAL_DEFINITION.key,
      nodeDefinitionVersion: 1,
      configuration: {},
    }).expect(409);
    await client.db.execute(
      sql`UPDATE node_definitions SET status = 'ACTIVE' WHERE key = ${OPTIONAL_DEFINITION.key} AND version = 1`,
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/investigations/${f.investigationId}`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .send({ status: "PAUSED" })
      .expect(200);
    await createNode(f.investigationId, {
      nodeDefinitionKey: OPTIONAL_DEFINITION.key,
      nodeDefinitionVersion: 1,
      configuration: {},
    }).expect(409);
  });

  it("replaces InputBindings wholesale, rejects a sourceType mismatch with nothing persisted (P3-002)", async () => {
    const f = await fixture();
    const node = (
      await createNode(f.investigationId, {
        nodeDefinitionKey: REQUIRED_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      }).expect(201)
    ).body;
    expect(node.status).toBe("DRAFT");

    await replaceBindings(
      node.id,
      [
        {
          targetInput: "fullName",
          sourceExpression: "person.full_name",
          sourceType: "NUMBER",
          sourceClassification: null,
        },
      ],
      1,
    ).expect(400);
    const afterRejection = (await get(`/nodes/${node.id}`).expect(200)).body;
    expect(afterRejection.inputBindings).toHaveLength(0);
    expect(afterRejection.status).toBe("DRAFT");
    expect(afterRejection.revision).toBe(1);

    const ready = (
      await replaceBindings(
        node.id,
        [
          {
            targetInput: "fullName",
            sourceExpression: "person.full_name",
            sourceType: "STRING",
            sourceClassification: "SENSITIVE",
          },
        ],
        1,
      ).expect(200)
    ).body;
    expect(ready.status).toBe("READY");
    expect(ready.inputBindings).toHaveLength(1);
    expect(ready.revision).toBe(2);

    // Replacing again with an empty set removes the binding and reverts to DRAFT.
    const draftAgain = (await replaceBindings(node.id, [], 2).expect(200)).body;
    expect(draftAgain.status).toBe("DRAFT");
    expect(draftAgain.inputBindings).toHaveLength(0);
  });

  it("rejects a targetInput absent from the NodeDefinition and a duplicate targetInput", async () => {
    const f = await fixture();
    const node = (
      await createNode(f.investigationId, {
        nodeDefinitionKey: REQUIRED_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      }).expect(201)
    ).body;
    await replaceBindings(
      node.id,
      [
        {
          targetInput: "doesNotExist",
          sourceExpression: "a",
          sourceType: "STRING",
          sourceClassification: null,
        },
      ],
      1,
    ).expect(400);
    await replaceBindings(
      node.id,
      [
        {
          targetInput: "fullName",
          sourceExpression: "a",
          sourceType: "STRING",
          sourceClassification: null,
        },
        {
          targetInput: "fullName",
          sourceExpression: "b",
          sourceType: "STRING",
          sourceClassification: null,
        },
      ],
      1,
    ).expect(400);
  });

  it("updates configuration via PATCH and requires If-Match", async () => {
    const f = await fixture();
    const node = (
      await createNode(f.investigationId, {
        nodeDefinitionKey: OPTIONAL_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      }).expect(201)
    ).body;
    await request(app.getHttpServer())
      .patch(`/api/v1/nodes/${node.id}`)
      .set("authorization", "Bearer owner")
      .send({ configuration: { timeoutOverride: 5 } })
      .expect(400);
    const updated = (
      await request(app.getHttpServer())
        .patch(`/api/v1/nodes/${node.id}`)
        .set("authorization", "Bearer owner")
        .set("if-match", '"1"')
        .send({ configuration: { timeoutOverride: 5 } })
        .expect(200)
    ).body;
    expect(updated.configuration).toEqual({ timeoutOverride: 5 });
    expect(updated.revision).toBe(2);
    await request(app.getHttpServer())
      .patch(`/api/v1/nodes/${node.id}`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .send({ configuration: { timeoutOverride: 9 } })
      .expect(412);
  });

  it("soft-archives via DELETE (204, not a SQL DELETE) and rejects further mutation", async () => {
    const f = await fixture();
    const node = (
      await createNode(f.investigationId, {
        nodeDefinitionKey: OPTIONAL_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      }).expect(201)
    ).body;
    await request(app.getHttpServer())
      .delete(`/api/v1/nodes/${node.id}`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .expect(204);
    const row = await client.db.execute(
      sql`SELECT status FROM node_instances WHERE id = ${node.id}`,
    );
    expect((row.rows[0] as { status: string }).status).toBe("ARCHIVED");
    await request(app.getHttpServer())
      .patch(`/api/v1/nodes/${node.id}`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"2"')
      .send({ configuration: {} })
      .expect(409);
  });

  it("creates a WorkflowEdge and rejects self-loop, duplicate, and cycle", async () => {
    const f = await fixture();
    const a = (
      await createNode(f.investigationId, {
        nodeDefinitionKey: OPTIONAL_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      }).expect(201)
    ).body;
    const b = (
      await createNode(f.investigationId, {
        nodeDefinitionKey: OPTIONAL_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      }).expect(201)
    ).body;
    await createEdge(f.investigationId, a.id, a.id).expect(400);
    await createEdge(f.investigationId, a.id, b.id).expect(201);
    await createEdge(f.investigationId, a.id, b.id).expect(409);
    await createEdge(f.investigationId, b.id, a.id).expect(409);
  });

  it("denies a non-member and a VIEWER attempting WORKFLOW_CREATE, and hides cross-Case NodeInstances", async () => {
    const f = await fixture();
    await createNode(
      f.investigationId,
      {
        nodeDefinitionKey: OPTIONAL_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      },
      newUuid(),
      "outsider",
    ).expect(404);
    await client.db.execute(
      sql`INSERT INTO workspace_members (id, workspace_id, user_id, status, joined_at) VALUES (${newUuid()}, ${f.workspaceId}, 'viewer', 'ACTIVE', now())`,
    );
    await asUser(() => cases.addMember(f.id, "viewer", "VIEWER", "Workflow test review"));
    await createNode(
      f.investigationId,
      {
        nodeDefinitionKey: OPTIONAL_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      },
      newUuid(),
      "viewer",
    ).expect(404);
    const node = (
      await createNode(f.investigationId, {
        nodeDefinitionKey: OPTIONAL_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      }).expect(201)
    ).body;
    await get(`/nodes/${node.id}`, "viewer").expect(200);

    const other = await fixture();
    const otherNode = (
      await createNode(other.investigationId, {
        nodeDefinitionKey: OPTIONAL_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      }).expect(201)
    ).body;
    await createEdge(f.investigationId, node.id, otherNode.id).expect(404);
  });

  it("rolls back NodeInstance, history and idempotency record if Outbox insertion fails", async () => {
    const f = await fixture();
    const key = newUuid();
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_node_instance_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'NODE_INSTANCE_CREATED' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_node_instance_event BEFORE INSERT ON platform_outbox_events FOR EACH ROW EXECUTE FUNCTION fail_node_instance_event();`,
      ),
    );
    try {
      const failed = await createNode(
        f.investigationId,
        {
          nodeDefinitionKey: OPTIONAL_DEFINITION.key,
          nodeDefinitionVersion: 1,
          configuration: {},
        },
        key,
      ).expect(500);
      expect(JSON.stringify(failed.body)).not.toContain("synthetic-private");
      expect(
        (
          await client.db.execute(
            sql`SELECT id FROM node_instances WHERE investigation_id = ${f.investigationId}`,
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.db.execute(
            sql`SELECT node_instance_id FROM node_instance_idempotency WHERE idempotency_key = ${key}`,
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_node_instance_event ON platform_outbox_events; DROP FUNCTION fail_node_instance_event();",
        ),
      );
    }
    await createNode(
      f.investigationId,
      {
        nodeDefinitionKey: OPTIONAL_DEFINITION.key,
        nodeDefinitionVersion: 1,
        configuration: {},
      },
      key,
    ).expect(201);
  });

  async function fixture() {
    const workspace = await asUser(() =>
      workspaces.create(
        {
          name: "Synthetic Workflow",
          slug: `workflow-${newUuid()}`,
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
        { title: "Synthetic Investigation", objective: "Workflow test objective." },
        newUuid(),
      ),
    );
    return {
      id: created.id,
      workspaceId: created.workspaceId,
      investigationId: investigation.id,
    };
  }
  function get(path: string, user = "owner") {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set("authorization", `Bearer ${user}`);
  }
  function createNode(
    investigationId: string,
    input: object,
    key = newUuid(),
    user = "owner",
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/investigations/${investigationId}/nodes`)
      .set("authorization", `Bearer ${user}`)
      .set("idempotency-key", key)
      .send(input);
  }
  function replaceBindings(
    nodeInstanceId: string,
    bindings: unknown[],
    revision: number,
    user = "owner",
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/nodes/${nodeInstanceId}/input-bindings`)
      .set("authorization", `Bearer ${user}`)
      .set("if-match", `"${revision}"`)
      .send({ bindings });
  }
  function createEdge(
    investigationId: string,
    fromNodeInstanceId: string,
    toNodeInstanceId: string,
    user = "owner",
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/investigations/${investigationId}/workflow-edges`)
      .set("authorization", `Bearer ${user}`)
      .send({ fromNodeInstanceId, toNodeInstanceId });
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

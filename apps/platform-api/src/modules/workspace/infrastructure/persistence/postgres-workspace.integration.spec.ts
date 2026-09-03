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
import { PostgresOutboxStore } from "../../../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import { WorkspaceFacade } from "../../application/workspace.facade.js";
import { PostgresWorkspaceRepository } from "./postgres-workspace.repository.js";

describe("Workspace persistence", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let context: RequestContextStore;
  let facade: WorkspaceFacade;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 5 });
    const database = new DatabaseContext(client.db);
    const transactions = new DrizzleTransactionManager(client.db);
    context = new RequestContextStore();

    const workspaceMigration = fs.readFileSync(
      new URL("./migrations/0001_create_workspace.sql", import.meta.url),
      "utf8",
    );
    const outboxMigration = fs.readFileSync(
      new URL(
        "../../../../platform/events/outbox/infrastructure/persistence/migrations/0001_create_platform_outbox.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await client.db.execute(sql.raw(workspaceMigration));
    await client.db.execute(sql.raw(outboxMigration));

    const outbox = new PostgresOutboxStore(database, context);
    const repository = new PostgresWorkspaceRepository(database, outbox);
    facade = new WorkspaceFacade(repository, transactions, context);
  });

  afterAll(async () => {
    await client?.pool.end();
    await started?.container.stop();
  });

  it("atomically creates a UUIDv7 workspace, membership history, and outbox events", async () => {
    const first = await runAsUser("user-a", () =>
      facade.create(workspaceInput("alpha-workspace"), "workspace-request-0001"),
    );
    const replay = await runAsUser("user-a", () =>
      facade.create(workspaceInput("alpha-workspace"), "workspace-request-0001"),
    );

    expect(uuidVersion(first.id)).toBe(7);
    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({
      slug: "alpha-workspace",
      status: "ACTIVE",
      revision: 1,
      settings: { locale: "id-ID", timeZone: "Asia/Jakarta" },
    });

    const counts = await client.db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM workspaces) AS workspaces,
        (SELECT count(*)::int FROM workspace_membership_history) AS history,
        (SELECT count(*)::int FROM platform_outbox_events) AS outbox
    `);
    expect(counts.rows[0]).toMatchObject({ workspaces: 1, history: 1, outbox: 2 });
  });

  it("does not disclose a workspace to a user without membership", async () => {
    await expect(runAsUser("user-b", () => facade.list())).resolves.toEqual([]);
    const owned = await runAsUser("user-a", () => facade.list());

    await expect(
      runAsUser("user-b", () => facade.get(owned[0]!.id)),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND", statusCode: 404 });
  });

  it("rejects reuse of an idempotency key with a different request", async () => {
    await expect(
      runAsUser("user-a", () =>
        facade.create(workspaceInput("different-workspace"), "workspace-request-0001"),
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
      statusCode: 409,
    });
  });

  it("does not treat a service principal as a workspace member", async () => {
    await expect(
      context.run(
        {
          requestId: "request-service",
          traceId: "trace-service",
          issuedAt: new Date().toISOString(),
          principal: {
            kind: "SERVICE",
            subject: "connector-worker",
            serviceId: "connector-worker",
            clientId: "connector-worker",
            issuer: "https://identity.example.test",
          },
        },
        () => facade.list(),
      ),
    ).rejects.toMatchObject({ code: "AUTH_USER_REQUIRED", statusCode: 403 });
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
});

function workspaceInput(slug: string) {
  return {
    name: "Investigation Team",
    slug,
    locale: "id-ID",
    timeZone: "Asia/Jakarta",
  };
}
